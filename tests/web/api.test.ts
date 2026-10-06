// @vitest-environment node
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { POST as detect } from "@/app/api/detect/route";
import { POST as extract } from "@/app/api/extract/route";
import { POST as grammar } from "@/app/api/grammar/route";
import { POST as plagiarism } from "@/app/api/plagiarism/route";
import { POST as rewrite } from "@/app/api/rewrite/route";
import { POST as find } from "@/app/api/citations/find/route";
import { POST as verify } from "@/app/api/citations/verify/route";
import { POST as report } from "@/app/api/report/route";
import { GET as status } from "@/app/api/status/route";
import { clientKey } from "@/server/api";
import { readConfig } from "@/server/config";
import { SAMPLE_PAPER } from "@/lib/sample";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/x", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  (globalThis as { __veritomeLimiters?: unknown }).__veritomeLimiters = undefined;
  vi.unstubAllEnvs();
  vi.stubEnv("LLM_BASE_URL", "");
  vi.stubEnv("LLM_MODEL", "");
  vi.stubEnv("LANGUAGETOOL_URL", "");
  vi.stubEnv("BRAVE_API_KEY", "");
  vi.stubEnv("SERPER_API_KEY", "");
  vi.stubEnv("LIBRARY_DIR", "");
});

describe("config", () => {
  test("reads env with safe defaults", () => {
    const c = readConfig({ RATE_LIMIT_PER_MINUTE: "abc", ALLOW_CLIENT_LLM: "true", LLM_MODEL: " m " });
    expect(c.rateLimitPerMinute).toBe(30);
    expect(c.allowClientLlm).toBe(true);
    expect(c.allowPrivateLlm).toBe(false);
    expect(c.llm.model).toBe("m");
  });
  test("client key ignores forwarding headers unless the proxy is trusted", () => {
    const r = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientKey(r, false)).toBe("shared");
    expect(clientKey(r, true)).toBe("1.2.3.4");
  });
});

describe("routes", () => {
  test("status reveals capabilities but no secrets", async () => {
    vi.stubEnv("LLM_BASE_URL", "https://llm.example/v1");
    vi.stubEnv("LLM_MODEL", "m1");
    vi.stubEnv("LLM_API_KEY", "sk-secret");
    const res = await status();
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ llm: true, llmModel: "m1", languageTool: false });
    expect(body).not.toContain("sk-secret");
    expect(body).not.toContain("llm.example");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("grammar returns issues and rejects bad input", async () => {
    const ok = await grammar(post({ text: "This is is a test of the the checker." }));
    expect(ok.status).toBe(200);
    const data = await ok.json();
    expect(data.issues.some((i: { rule: string }) => i.rule === "repeated-word")).toBe(true);
    expect((await grammar(post({ text: "   " }))).status).toBe(400);
    const bad = await grammar(new Request("http://x", { method: "POST", body: "not json" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/JSON object/);
  });

  test("detect works without a language model and says so", async () => {
    const res = await detect(post({ text: SAMPLE_PAPER, useLlm: true }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.disclaimer).toBeTruthy();
    expect(data.warnings.join(" ")).toMatch(/No language model/);
  });

  test("rewrite falls back to rules and validates the mode", async () => {
    const res = await rewrite(post({ text: "Moreover, it is important to note that this plays a pivotal role in budgets (Smith, 2020).", mode: "humanise" }));
    const data = await res.json();
    expect(data.method).toBe("rules");
    expect(data.text).toContain("(Smith, 2020)");
    expect(data.disclosure).toBeTruthy();
    expect((await rewrite(post({ text: "x", mode: "pirate" }))).status).toBe(400);
  });

  test("a browser-supplied LLM is ignored unless the operator allows it, and private URLs are refused", async () => {
    const llm = { baseUrl: "http://169.254.169.254/v1", model: "x" };
    const ignored = await rewrite(post({ text: "Some text to rewrite here.", mode: "academic", llm }));
    expect((await ignored.json()).method).toBe("rules");
    vi.stubEnv("ALLOW_CLIENT_LLM", "true");
    const refused = await rewrite(post({ text: "Some text to rewrite here.", mode: "academic", llm }));
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/not allowed/);
  });

  test("external lookups need consent; offline plagiarism with a library works", async () => {
    const needs = await plagiarism(post({ text: SAMPLE_PAPER }));
    expect(needs.status).toBe(428);
    expect((await verify(post({ references: "Smith, J. (2020). A title here. Journal, 1, 1-2." }))).status).toBe(428);
    expect((await find(post({ claim: "Riparian zones matter a lot for carbon." }))).status).toBe(428);
    expect((await report(post({ text: SAMPLE_PAPER }))).status).toBe(428);

    const lib = { title: "Old draft", text: "Two did not: the alder stands near the river kept respiring at almost the summer rate well into October." };
    const res = await plagiarism(post({ text: SAMPLE_PAPER, external: false, library: [lib] }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.similarity).toBeGreaterThan(5);
    expect(data.sources[0].title).toBe("Old draft");
  });

  test("claim finding is offline and report runs offline", async () => {
    const claims = await (await find(post({ text: SAMPLE_PAPER }))).json();
    expect(claims.claims.length).toBeGreaterThan(0);
    const res = await report(post({ text: SAMPLE_PAPER, external: false, tools: { paraphrase: false } }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.overview).toHaveLength(6);
    expect(data.paraphrase.status).toBe("skipped");
    expect(data.citations.result.verificationSkipped).toMatch(/not available/);
  });

  test("rate limiting returns 429 with Retry-After", async () => {
    vi.stubEnv("RATE_LIMIT_PER_MINUTE", "2");
    const go = () => grammar(post({ text: "Hello there." }));
    expect((await go()).status).toBe(200);
    expect((await go()).status).toBe(200);
    const limited = await go();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  test("extract reads an uploaded .docx and rejects unsupported files", async () => {
    const form = new FormData();
    form.append("file", new File([readFileSync("tests/fixtures/sample.docx")], "sample.docx"));
    const res = await extract(new Request("http://x", { method: "POST", body: form }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.kind).toBe("docx");
    expect(data.text).toContain("14 sites");
    const bad = new FormData();
    bad.append("file", new File(["x"], "sheet.xls"));
    const r2 = await extract(new Request("http://x", { method: "POST", body: bad }));
    expect(r2.status).toBe(422);
  });
});
