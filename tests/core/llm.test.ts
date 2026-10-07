import assert from "node:assert/strict";
import { test } from "node:test";
import { chatCompletionsUrl, createLlmClient, extractJson, LlmError } from "../../src/core/llm/client.ts";
import { resolveLlmConfig } from "../../src/core/llm/config.ts";
import { UnsafeUrlError } from "../../src/core/infra/netguard.ts";
import { jsonResponse, mockFetch } from "./helpers.ts";

const ok = (content: string) => jsonResponse({ choices: [{ message: { content } }] });

test("chatCompletionsUrl normalises base URLs", () => {
  assert.equal(chatCompletionsUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");
  assert.equal(chatCompletionsUrl("http://localhost:11434/v1/"), "http://localhost:11434/v1/chat/completions");
  assert.equal(chatCompletionsUrl("https://x.org/v1/chat/completions"), "https://x.org/v1/chat/completions");
});

test("chat sends model, messages and bearer key, returns content", async () => {
  const { fetch, calls } = mockFetch(() => ok("hello"));
  const llm = createLlmClient({ baseUrl: "https://llm.example/v1", apiKey: "sk-test", model: "m1" }, { fetch });
  const out = await llm.chat({ system: "sys", user: "usr", temperature: 0.2 });
  assert.equal(out, "hello");
  const call = calls[0];
  assert.equal(call?.headers.authorization, "Bearer sk-test");
  const body = JSON.parse(call?.body ?? "{}");
  assert.equal(body.model, "m1");
  assert.equal(body.temperature, 0.2);
  assert.deepEqual(
    body.messages.map((m: { role: string }) => m.role),
    ["system", "user"],
  );
  assert.equal(body.response_format, undefined);
});

test("json mode falls back when the server rejects response_format", async () => {
  let n = 0;
  const { fetch, calls } = mockFetch(() => (++n === 1 ? jsonResponse({ error: {} }, 400) : ok('{"a":1}')));
  const llm = createLlmClient({ baseUrl: "https://llm.example/v1", model: "m" }, { fetch });
  const out = await llm.chat({ system: "s", user: "u", json: true });
  assert.equal(out, '{"a":1}');
  assert.equal(calls.length, 2);
  assert.ok(JSON.parse(calls[0]?.body ?? "{}").response_format);
  assert.equal(JSON.parse(calls[1]?.body ?? "{}").response_format, undefined);
});

test("reasoning effort is sent when configured and dropped if the server rejects it", async () => {
  let n = 0;
  const { fetch, calls } = mockFetch(() => (++n === 1 ? jsonResponse({ error: {} }, 400) : ok("hi")));
  const llm = createLlmClient({ baseUrl: "https://llm.example/v1", model: "m", reasoningEffort: "low" }, { fetch });
  assert.equal(await llm.chat({ system: "s", user: "u" }), "hi");
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0]?.body ?? "{}").reasoning_effort, "low");
  assert.equal(JSON.parse(calls[1]?.body ?? "{}").reasoning_effort, undefined);
});

test("resolveLlmConfig reads LLM_REASONING_EFFORT", async () => {
  const cfg = await resolveLlmConfig({
    env: { LLM_BASE_URL: "https://env.example/v1", LLM_MODEL: "m", LLM_REASONING_EFFORT: " low " },
    allowClientConfig: false,
    allowPrivate: false,
  });
  assert.equal(cfg?.reasoningEffort, "low");
});

test("errors are mapped to friendly messages and never leak the key", async () => {
  const { fetch } = mockFetch(() => jsonResponse({}, 401));
  const llm = createLlmClient({ baseUrl: "https://llm.example/v1", apiKey: "sk-SECRET", model: "m" }, { fetch });
  await assert.rejects(
    () => llm.chat({ system: "s", user: "u" }),
    (err: unknown) => {
      assert.ok(err instanceof LlmError);
      assert.match(err.message, /rejected the API key/);
      assert.ok(!err.message.includes("sk-SECRET"));
      return true;
    },
  );
});

test("empty completions are an error", async () => {
  const { fetch } = mockFetch(() => ok("   "));
  const llm = createLlmClient({ baseUrl: "https://llm.example/v1", model: "m" }, { fetch });
  await assert.rejects(() => llm.chat({ system: "s", user: "u" }), LlmError);
});

test("extractJson handles fences, chatter and garbage", () => {
  assert.deepEqual(extractJson('```json\n{"x": 1}\n```'), { x: 1 });
  assert.deepEqual(extractJson('Sure! Here you go: {"x": [1,2]} Hope that helps.'), { x: [1, 2] });
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson("{broken"), null);
});

const resolve = async () => ["93.184.216.34"];

test("resolveLlmConfig prefers a permitted browser override over the environment", async () => {
  const cfg = await resolveLlmConfig({
    env: { LLM_BASE_URL: "https://env.example/v1", LLM_MODEL: "env-model", LLM_API_KEY: "env-key" },
    override: { baseUrl: "https://user.example/v1", model: "user-model", apiKey: "user-key" },
    allowClientConfig: true,
    allowPrivate: false,
    resolve,
  });
  assert.deepEqual(cfg, { baseUrl: "https://user.example/v1", model: "user-model", apiKey: "user-key" });
});

test("resolveLlmConfig ignores the browser override when disabled", async () => {
  const cfg = await resolveLlmConfig({
    env: { LLM_BASE_URL: "https://env.example/v1", LLM_MODEL: "env-model" },
    override: { baseUrl: "https://user.example/v1", model: "user-model" },
    allowClientConfig: false,
    allowPrivate: false,
    resolve,
  });
  assert.deepEqual(cfg, { baseUrl: "https://env.example/v1", model: "env-model" });
});

test("resolveLlmConfig rejects unsafe browser URLs and returns null when nothing is set", async () => {
  await assert.rejects(
    () =>
      resolveLlmConfig({
        env: {},
        override: { baseUrl: "http://169.254.169.254/v1", model: "m" },
        allowClientConfig: true,
        allowPrivate: true,
        resolve,
      }),
    UnsafeUrlError,
  );
  const none = await resolveLlmConfig({ env: {}, allowClientConfig: true, allowPrivate: false, resolve });
  assert.equal(none, null);
});
