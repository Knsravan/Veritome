import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatRequest, LlmClient } from "../../src/core/llm/client.ts";
import { assemble, checkRewrite, humaniseParagraph, humaniseSystemPrompt, paragraphEdits, planParagraphs } from "../../src/core/rewrite/humanise.ts";

/** A fake model: rewrite calls get the next scripted reply; meaning checks answer with `same`. */
function fake(rewrites: string[], same: boolean | boolean[] = true): LlmClient & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  let r = 0;
  let c = 0;
  return {
    model: "fake",
    calls,
    async chat(req) {
      calls.push(req);
      if (req.json) {
        const ok = Array.isArray(same) ? same[Math.min(c++, same.length - 1)] : same;
        return JSON.stringify({ same_meaning: ok, problems: ok ? [] : ["it drops the caveat about small samples"] });
      }
      return rewrites[Math.min(r++, rewrites.length - 1)] ?? "";
    },
  };
}

const PARA =
  "It is important to note that the method plays a crucial role in the analysis (Smith et al., 2020). Moreover, accuracy rose to 94.2% in the test set [3].";

test("a good rewrite keeps citations and numbers and passes the meaning check", async () => {
  const llm = fake(["The method is central to the analysis {{P1}}, and accuracy on the test set rose to 94.2% {{P2}}."]);
  const r = await humaniseParagraph(PARA, { tone: "academic", strength: "balanced", llm });
  assert.equal(r.status, "rewritten");
  assert.equal(r.meaningChecked, true);
  assert.match(r.text, /\(Smith et al\., 2020\)/);
  assert.match(r.text, /\[3\]/);
  assert.match(r.text, /94\.2%/);
  assert.ok(r.changed > 0);
});

test("a rewrite that drops a citation or changes a number is retried with the reason", async () => {
  const llm = fake([
    "The method is central to the analysis, and accuracy rose to 95% {{P2}}.",
    "The method is central to the analysis {{P1}}, and accuracy on the test set rose to 94.2% {{P2}}.",
  ]);
  const r = await humaniseParagraph(PARA, { tone: "academic", strength: "balanced", llm });
  assert.equal(r.status, "rewritten");
  assert.equal(r.attempts, 2);
  const retryPrompt = llm.calls.filter((c) => !c.json)[1]!.user;
  assert.match(retryPrompt, /previous attempt was rejected/);
  assert.match(retryPrompt, /\{\{P1\}\}/);
});

test("a rewrite that changes the meaning is rejected, and after every attempt fails the original is kept", async () => {
  const llm = fake(["The method is central to the analysis {{P1}}, and accuracy on the test set rose to 94.2% {{P2}}."], false);
  const r = await humaniseParagraph(PARA, { tone: "natural", strength: "balanced", llm, retries: 1 });
  assert.equal(r.status, "kept_original");
  assert.equal(r.text, PARA);
  assert.match(r.problems.join(" "), /caveat/);
});

test("the voice sample and the stiff habits are in the prompt, and markdown is refused", () => {
  const p = humaniseSystemPrompt("academic", "strong", "We measured it twice. It held.");
  assert.match(p, /<voice>[\s\S]*It held\.[\s\S]*<\/voice>/);
  assert.match(p, /delve into/);
  assert.deepEqual(checkRewrite("A short sentence about the method and the data used here.", "A **short** sentence about the method and the data used here.", "light"), [
    "it added markdown formatting",
  ]);
});

test("headings, author lines and references are left alone, and pieces reassemble to the text", () => {
  const prose = "Quantum computers process many states at once, which makes some problems far easier to solve than they were before.";
  const text = ["A Simulator for Qubits", "Introduction", prose, "References", "1. Kandadi, T. (2025). A title. SSRN."].join("\n\n");
  const pieces = planParagraphs(text);
  assert.deepEqual(
    pieces.map((p) => p.rewrite),
    [false, false, true, false, false],
  );
  assert.equal(assemble(text, pieces, pieces.map((p) => p.text)), text);
  const replaced = assemble(text, pieces, pieces.map((p) => (p.rewrite ? "NEW" : p.text)));
  assert.equal(replaced, text.replace(prose, "NEW"));
});

test("a long paragraph is split between sentences", () => {
  const sentence = "The sensors recorded the temperature of the river every ten minutes for the whole season. ";
  const text = sentence.repeat(60).trim();
  const pieces = planParagraphs(text);
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every((p) => p.text.length <= 2600));
  assert.equal(assemble(text, pieces, pieces.map((p) => p.text)), text);
});

test("text pasted without paragraph breaks is split into paragraphs at sentence ends", async () => {
  const { reflowParagraphs } = await import("../../src/core/text/reflow.ts");
  const sentence = "The sensors recorded the river temperature every ten minutes for the whole season. ";
  const flat = sentence.repeat(50).trim();
  const out = reflowParagraphs(flat);
  const paras = out.split("\n\n");
  assert.ok(paras.length >= 5);
  assert.ok(paras.every((p) => p.endsWith(".")));
  assert.equal(out.replace(/\n\n/g, " "), flat);
  const short = "One short paragraph.\n\nAnother one.";
  assert.equal(reflowParagraphs(short), short);
});

test("the prompt asks for plain words, not fancier synonyms", () => {
  const p = humaniseSystemPrompt("academic", "balanced");
  assert.match(p, /plainest accurate word/);
  assert.match(p, /Never replace a plain word with a fancier synonym/);
});

test("planParagraphs keeps headings and displayed equations out of the rewrite, each as it is", () => {
  const text =
    "I. INTRODUCTION\nA computer science student who meets quantum mechanics for the first time often finds the notation hard to follow, and the\nsimulators we tried did not help them much at all.\n\nThe state space grows quickly as qubits are added to the register:\ndim(ℋ𝑁) = 2𝑁 (8)\nwhere each added qubit doubles the number of amplitudes the simulator has to keep in memory.";
  const pieces = planParagraphs(text);
  assert.deepEqual(
    pieces.map((p) => [p.rewrite, p.text.split("\n")[0]]),
    [
      [false, "I. INTRODUCTION"],
      [true, "A computer science student who meets quantum mechanics for the first time often finds the notation hard to follow, and the"],
      [true, "The state space grows quickly as qubits are added to the register:"],
      [false, "dim(ℋ𝑁) = 2𝑁 (8)"],
      [true, "where each added qubit doubles the number of amplitudes the simulator has to keep in memory."],
    ],
  );
  for (const p of pieces) assert.equal(text.slice(p.start, p.end), p.text);
});

test("paragraphEdits joins the parts of one long paragraph and leaves out unchanged paragraphs", () => {
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i + 1} describes one more step of the long method in some detail.`).join(" ");
  const text = `Methods\n\n${long}\n\nA final paragraph that is not changed by the rewrite at all here.`;
  const pieces = planParagraphs(text);
  const parts = pieces.filter((p) => p.text.startsWith("Sentence"));
  assert.ok(parts.length >= 2, "the long paragraph is revised in parts");
  const edits = paragraphEdits(text, pieces, pieces.map((p) => (p.text.startsWith("A final") ? p.text : p.text.replace(/Sentence/g, "Line"))));
  assert.equal(edits.length, 1);
  assert.equal(text.slice(edits[0]!.start, edits[0]!.end), long);
  assert.ok(edits[0]!.text.startsWith("Line number 1 "));
  assert.ok(edits[0]!.text.endsWith("in some detail."));
});
