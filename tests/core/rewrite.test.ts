import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatRequest, LlmClient } from "../../src/core/llm/client.ts";
import { cleanReply, planChunks, rewriteText, ruleRewrite, validatePiece } from "../../src/core/rewrite/index.ts";
import { changedShare, diffWords } from "../../src/core/text/diff.ts";
import { protect } from "../../src/core/text/protect.ts";

function scripted(replies: Array<string | ((req: ChatRequest) => string)>): LlmClient & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    model: "fake-model",
    calls,
    async chat(req) {
      calls.push(req);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      return typeof r === "function" ? r(req) : (r ?? "");
    },
  };
}

const TEXT =
  "It is important to note that the method plays a crucial role in the analysis (Smith et al., 2020). " +
  "Moreover, accuracy rose to 94.2% when $\\alpha = 0.5$ was used [3].";

test("diffWords marks additions and deletions and round-trips", () => {
  const ops = diffWords("the quick brown fox", "the slow brown fox jumps");
  assert.equal(ops.filter((o) => o.type !== "add").map((o) => o.text).join(""), "the quick brown fox");
  assert.equal(ops.filter((o) => o.type !== "del").map((o) => o.text).join(""), "the slow brown fox jumps");
  assert.ok(ops.some((o) => o.type === "del" && o.text.includes("quick")));
  assert.equal(changedShare(diffWords("a b c d", "a b c d")), 0);
  assert.equal(changedShare(diffWords("a b c d", "w x y z")), 1);
  const big = diffWords("a ".repeat(3000), "b ".repeat(3000), 1000);
  assert.deepEqual(big.map((o) => o.type), ["del", "add", "same"]);
});

test("cleanReply strips prefaces, fences and wrapping quotes", () => {
  assert.equal(cleanReply("Here is the rewritten passage:\nHello there."), "Hello there.");
  assert.equal(cleanReply("```\nHello.\n```"), "Hello.");
  assert.equal(cleanReply("“Hello world.”"), "Hello world.");
  assert.equal(cleanReply('He said "no" twice.'), 'He said "no" twice.');
});

test("ruleRewrite humanise removes stock phrases and openers, keeps placeholders", () => {
  const { masked } = protect(TEXT);
  const r = ruleRewrite(masked, "humanise");
  assert.ok(r.edits >= 3);
  assert.match(r.text, /^The method is central to the analysis \{\{P1\}\}\./);
  assert.match(r.text, /\. Accuracy rose to 94\.2% when \{\{P2\}\} was used \{\{P3\}\}\./);
});

test("ruleRewrite humanise drops an opener followed by a deleted phrase", () => {
  assert.equal(ruleRewrite("Moreover, it is important to note that riparian zones matter.", "humanise").text, "Riparian zones matter.");
});

test("ruleRewrite academic expands contractions; concise drops weak words", () => {
  assert.equal(ruleRewrite("We don't know a lot of things.", "academic").text, "We do not know many things.");
  assert.equal(ruleRewrite("This is very clear in order to help.", "concise").text, "This is clear to help.");
  assert.equal(ruleRewrite("Unchanged text.", "expand").edits, 0);
});

test("ruleRewrite capitalises only where a deletion opened a sentence", () => {
  const out = ruleRewrite("We used e.g. kits. It should be noted that results vary. It is clear.", "humanise").text;
  assert.equal(out, "We used e.g. kits. Results vary. It is clear.");
});

test("validatePiece catches placeholder, number and length problems", () => {
  const { masked, spans } = protect(TEXT);
  assert.equal(validatePiece(masked, masked, spans, "academic").ok, true);
  const dropped = validatePiece(masked, masked.replace("{{P2}}", ""), spans, "academic");
  assert.equal(dropped.ok, false);
  assert.match((dropped as { problems: string[] }).problems.join(" "), /\{\{P2\}\} are missing/);
  const changed = validatePiece(masked, masked.replace("94.2", "95"), spans, "academic");
  assert.match((changed as { problems: string[] }).problems.join(" "), /94\.2.*dropped/);
  const invented = validatePiece(masked, `${masked} {{P9}}`, spans, "academic");
  assert.match((invented as { problems: string[] }).problems.join(" "), /invented/);
  const short = validatePiece(masked, "{{P1}} {{P2}} {{P3}} 94.2", spans, "academic");
  assert.match((short as { problems: string[] }).problems.join(" "), /length changed/);
});

test("planChunks keeps paragraphs and splits long ones by sentence", () => {
  const text = "First para.\n\nSecond one is here. And more. And more text.";
  const pieces = planChunks(text, 20);
  assert.equal(text.slice(pieces[0]!.start, pieces[0]!.end), "First para.");
  assert.ok(pieces.length >= 3);
  for (const p of pieces) assert.ok(p.end - p.start <= 20);
});

test("rewriteText with an LLM restores protected spans and reports detector scores", async () => {
  const llm = scripted([
    (req) => {
      const passage = req.user.replace(/^Passage:\n/, "");
      return `Here is the rewritten passage:\n${passage.replace("It is important to note that the method plays a crucial role in", "The method is central to").replace("Moreover, accuracy", "Accuracy")}`;
    },
  ]);
  const r = await rewriteText(TEXT, { mode: "humanise", llm });
  assert.equal(r.method, "llm");
  assert.equal(r.model, "fake-model");
  assert.equal(r.chunks[0]?.status, "rewritten");
  assert.ok(r.text.includes("(Smith et al., 2020)"));
  assert.ok(r.text.includes("$\\alpha = 0.5$"));
  assert.ok(r.text.includes("[3]"));
  assert.ok(r.text.startsWith("The method is central to the analysis"));
  assert.equal(r.protectedCount, 3);
  assert.ok(r.disclosure && /disclose/.test(r.disclosure));
  assert.ok(r.changed > 0);
  assert.equal(typeof r.detector.before.score, "number");
  assert.match(llm.calls[0]!.system, /\{\{P1\}\}/);
  assert.ok(!llm.calls[0]!.user.includes("Smith"), "citations must not be sent to the model");
});

test("rewriteText retries with feedback and keeps the original after repeated failures", async () => {
  const bad = (req: ChatRequest) => req.user.replace(/^Passage:\n/, "").split("\n\nYour previous")[0]!.replace("94.2", "95");
  const llm = scripted([bad, bad, bad]);
  const r = await rewriteText(TEXT, { mode: "academic", llm });
  assert.equal(llm.calls.length, 3);
  assert.match(llm.calls[1]!.user, /previous attempt was rejected.*94\.2/);
  assert.equal(r.chunks[0]?.status, "kept_original");
  assert.equal(r.text, TEXT);
  assert.ok(r.warnings.some((w) => /kept the original wording/.test(w)));
  assert.equal(r.disclosure, undefined);
});

test("rewriteText succeeds on a retry", async () => {
  const good = (req: ChatRequest) => req.user.replace(/^Passage:\n/, "").split("\n\nYour previous")[0]!;
  const llm = scripted(["nonsense without placeholders but long enough to pass the length check here", good]);
  const r = await rewriteText(TEXT, { mode: "academic", llm });
  assert.equal(r.chunks[0]?.status, "rewritten");
  assert.equal(r.chunks[0]?.attempts, 2);
  assert.equal(r.text, TEXT);
});

test("rewriteText without an LLM falls back to rules and says so", async () => {
  const r = await rewriteText(`${TEXT}\n\nSecond paragraph, it is worth noting that it's fine.`, { mode: "humanise" });
  assert.equal(r.method, "rules");
  assert.ok(r.chunks.every((c) => c.status === "rules"));
  assert.ok(r.text.includes("\n\nSecond paragraph, it's fine."));
  assert.ok(r.warnings.some((w) => /rule-based/.test(w)));
  const e = await rewriteText(TEXT, { mode: "expand" });
  assert.equal(e.text, TEXT);
  assert.ok(e.warnings.some((w) => /needs a language model/.test(w)));
});

test("model errors keep the original text", async () => {
  const llm: LlmClient = { model: "x", chat: async () => Promise.reject(new Error("offline")) };
  const r = await rewriteText(TEXT, { mode: "simple", llm });
  assert.equal(r.text, TEXT);
  assert.match(r.chunks[0]!.problems[0]!, /offline/);
});
