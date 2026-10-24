import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttp, HttpError, mapLimit, redactUrl, TimeoutError } from "../../src/core/infra/http.ts";
import { createRateLimiter, createRedisRateLimiter, withFallback } from "../../src/core/infra/ratelimit.ts";
import { assertSafeUrl, isPrivateIp, UnsafeUrlError } from "../../src/core/infra/netguard.ts";
import { chunkBySentences } from "../../src/core/text/chunk.ts";
import { jsonResponse, mockFetch, noSleep } from "./helpers.ts";

test("http retries 5xx then succeeds and sends the user agent", async () => {
  let n = 0;
  const { fetch, calls } = mockFetch(() => (++n < 3 ? jsonResponse({}, 503) : jsonResponse({ ok: true })));
  const http = createHttp({ fetch, sleep: noSleep, userAgent: "Veritome/test (mailto:a@b.c)" });
  const data = await http.json<{ ok: boolean }>("https://api.example.org/x?secret=1");
  assert.equal(data.ok, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.headers["user-agent"], "Veritome/test (mailto:a@b.c)");
});

test("http does not retry 4xx and hides the query string in errors", async () => {
  const { fetch, calls } = mockFetch(() => jsonResponse({}, 404));
  const http = createHttp({ fetch, sleep: noSleep });
  await assert.rejects(
    () => http.json("https://api.example.org/x?apikey=SECRET"),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 404);
      assert.ok(!err.message.includes("SECRET"));
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test("http times out slow servers", async () => {
  const slow = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as unknown as typeof fetch;
  const http = createHttp({ fetch: slow, sleep: noSleep, timeoutMs: 20, retries: 0 });
  await assert.rejects(() => http.json("https://slow.example.org/"), TimeoutError);
});

test("redactUrl drops query and fragments", () => {
  assert.equal(redactUrl("https://a.org/p/q?k=v#h"), "https://a.org/p/q");
});

test("mapLimit preserves order and respects the concurrency cap", async () => {
  let active = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return x * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
  assert.ok(peak <= 2);
});

test("rate limiter blocks after the limit and resets after the window", () => {
  let t = 1000;
  const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(rl.check("ip").allowed, true);
  assert.equal(rl.check("ip").allowed, true);
  const blocked = rl.check("ip");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 1000);
  assert.equal(rl.check("other").allowed, true);
  t += 1001;
  assert.equal(rl.check("ip").allowed, true);
});

test("redis rate limiter shares one count, expires keys and reports the window end", async () => {
  const store = new Map<string, number>();
  const { fetch, calls } = mockFetch((call) => {
    const cmds = JSON.parse(call.body ?? "[]") as string[][];
    return jsonResponse(cmds.map(([cmd, key]) => (cmd === "INCR" ? { result: store.set(key!, (store.get(key!) ?? 0) + 1).get(key!) } : { result: 1 })));
  });
  let t = 60_500;
  const make = () => createRedisRateLimiter({ url: "https://db.example.io/", token: "tok", limit: 2, windowMs: 60_000, prefix: "vt:grammar", fetch, now: () => t });
  // Two separate instances, as on two serverless functions.
  const a = make();
  const b = make();
  assert.equal((await a.check("ip")).allowed, true);
  assert.equal((await b.check("ip")).allowed, true);
  const blocked = await a.check("ip");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 59_500);
  assert.equal((await b.check("other")).allowed, true);
  assert.equal(calls[0]?.url, "https://db.example.io/pipeline");
  assert.equal(calls[0]?.headers.authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(calls[0]?.body ?? ""), [["INCR", "vt:grammar:ip:1"], ["PEXPIRE", "vt:grammar:ip:1", "61000"]]);
  t = 120_000;
  assert.equal((await a.check("ip")).allowed, true);
});

test("redis rate limiter throws on errors and bad replies", async () => {
  for (const reply of [jsonResponse({}, 401), jsonResponse([{ error: "WRONGTYPE" }]), jsonResponse({ result: 1 })]) {
    const { fetch } = mockFetch(() => reply);
    const rl = createRedisRateLimiter({ url: "https://db.example.io", token: "t", limit: 5, windowMs: 1000, prefix: "p", fetch });
    await assert.rejects(() => Promise.resolve(rl.check("ip")));
  }
});

test("rate limiter falls back while the shared store is down and retries after a cooldown", async () => {
  let t = 0;
  let up = false;
  let primaryCalls = 0;
  const errors: unknown[] = [];
  const primary = {
    check: async () => {
      primaryCalls++;
      if (!up) throw new Error("down");
      return { allowed: false, remaining: 0, retryAfterMs: 5 };
    },
  };
  const rl = withFallback(primary, createRateLimiter({ limit: 1, windowMs: 100_000, now: () => t }), { cooldownMs: 1000, now: () => t, onError: (e) => errors.push(e) });
  assert.equal((await rl.check("ip")).allowed, true);
  assert.equal((await rl.check("ip")).allowed, false, "the local count still limits");
  assert.equal(primaryCalls, 1, "the store is skipped during the cooldown");
  assert.equal(errors.length, 1);
  up = true;
  t = 1000;
  assert.deepEqual(await rl.check("new"), { allowed: false, remaining: 0, retryAfterMs: 5 });
  assert.equal(primaryCalls, 2);
});

test("assertSafeUrl blocks metadata, bad schemes and credentials always", async () => {
  const resolve = async () => ["93.184.216.34"];
  for (const bad of [
    "http://169.254.169.254/latest/meta-data",
    "http://metadata.google.internal/computeMetadata/v1/",
    "file:///etc/passwd",
    "ftp://example.org/",
    "https://user:pw@example.org/",
    "not a url",
    "http://[::ffff:169.254.169.254]/",
    "http://[64:ff9b::169.254.169.254]/",
    "http://[2002:a9fe:a9fe::]/",
  ]) {
    await assert.rejects(() => assertSafeUrl(bad, { allowPrivate: true, resolve }), UnsafeUrlError, bad);
  }
});

test("assertSafeUrl allows private hosts only when enabled", async () => {
  const resolve = async () => ["93.184.216.34"];
  await assert.rejects(() => assertSafeUrl("http://localhost:11434/v1", { allowPrivate: false, resolve }), UnsafeUrlError);
  await assert.rejects(() => assertSafeUrl("http://192.168.1.5/v1", { allowPrivate: false, resolve }), UnsafeUrlError);
  const ok = await assertSafeUrl("http://localhost:11434/v1", { allowPrivate: true, resolve });
  assert.equal(ok.port, "11434");
  const pub = await assertSafeUrl("https://api.openai.com/v1", { allowPrivate: false, resolve });
  assert.equal(pub.hostname, "api.openai.com");
});

test("assertSafeUrl checks what the host name resolves to", async () => {
  const rebinding = async () => ["10.0.0.7"];
  await assert.rejects(() => assertSafeUrl("https://innocent.example.org/", { allowPrivate: false, resolve: rebinding }), UnsafeUrlError);
  const toMetadata = async () => ["169.254.169.254"];
  await assert.rejects(() => assertSafeUrl("https://innocent.example.org/", { allowPrivate: true, resolve: toMetadata }), UnsafeUrlError);
});

test("isPrivateIp covers common ranges", () => {
  for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "127.0.0.1", "::1", "fd12::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "93.184.216.34"]) assert.equal(isPrivateIp(ip), false, ip);
});

test("isPrivateIp sees through IPv6 addresses that carry an IPv4 one", () => {
  for (const ip of ["::7f00:1", "::127.0.0.1", "64:ff9b::a00:1", "64:ff9b::10.0.0.1", "2002:c0a8:101::1", "::ffff:7f00:1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["64:ff9b::808:808", "2002:808:808::", "2001:4860:4860::8888", "::808:808"]) assert.equal(isPrivateIp(ip), false, ip);
});

test("http can refuse redirects", async () => {
  const seen: Array<RequestRedirect | undefined> = [];
  const fetch = (async (_url: string, init?: RequestInit) => {
    seen.push(init?.redirect);
    return new Response("{}", { headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  await createHttp({ fetch, redirect: "error" }).json("https://api.example.org/");
  await createHttp({ fetch }).json("https://api.example.org/");
  assert.deepEqual(seen, ["error", undefined]);
});

test("chunkBySentences never cuts a sentence and maps back to the source", () => {
  const text = "One two three. Four five six. Seven eight nine. Ten eleven twelve. Thirteen.";
  const chunks = chunkBySentences(text, 32);
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    assert.equal(text.slice(c.start, c.end), c.text);
    assert.ok(c.text.endsWith("."));
  }
  assert.equal(chunks.map((c) => c.text).join(" "), text);
  const single = chunkBySentences("A very long single sentence without any stop to split it on", 10);
  assert.equal(single.length, 1);
});

test("pacedHttp spaces requests out and stops at its allowance", async () => {
  const { pacedHttp, RequestBudgetExceeded } = await import("../../src/core/infra/http.ts");
  let clock = 0;
  const starts: number[] = [];
  const inner = {
    json: async <T>() => (starts.push(clock), {} as T),
    text: async () => (starts.push(clock), ""),
  };
  const paced = pacedHttp(inner, {
    service: "Test",
    minIntervalMs: 3000,
    maxRequests: 3,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  await Promise.all([paced.json("a"), paced.text("b"), paced.json("c")]);
  assert.deepEqual(starts, [0, 3000, 6000]);
  await assert.rejects(paced.json("d"), RequestBudgetExceeded);
});
