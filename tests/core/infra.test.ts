import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttp, HttpError, mapLimit, redactUrl, TimeoutError } from "../../src/core/infra/http.ts";
import { createRateLimiter } from "../../src/core/infra/ratelimit.ts";
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
