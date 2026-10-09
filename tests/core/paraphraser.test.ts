import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatRequest, LlmClient } from "../../src/core/llm/client.ts";
import { paraphraseParagraph, paraphraseSystemPrompt, sentenceAlternatives, synonymsInContext } from "../../src/core/rewrite/paraphrase.ts";
import { protect } from "../../src/core/text/protect.ts";

function fake(replies: string[], same = true): LlmClient & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  let r = 0;
  return {
    model: "fake",
    calls,
    async chat(req) {
      calls.push(req);
      if (req.json && /compare an original/.test(req.system ?? "")) return JSON.stringify({ same_meaning: same, problems: same ? [] : ["it drops a caveat"] });
      return replies[Math.min(r++, replies.length - 1)] ?? "";
    },
  };
}

const PARA = "The method plays a crucial role in the analysis of river sediments (Smith et al., 2020), and accuracy reached 94.2%.";

test("protect keeps the author's chosen terms as placeholders, matched whole and ignoring case", () => {
  const { masked, spans } = protect("BB84 and bb84-like schemes; the BB84s and BB840 differ.", { keep: ["BB84"] });
  assert.equal(spans.filter((s) => s.kind === "keep").length, 2);
  assert.equal(masked, "{{P1}} and {{P2}}-like schemes; the BB84s and BB840 differ.");
});

test("a paraphrase keeps citations, numbers and locked words, and passes the meaning check", async () => {
  const llm = fake(["We rely on this method to analyse {{P2}}, and accuracy reached 94.2% {{P1}}."]);
  const r = await paraphraseParagraph(PARA, { style: "standard", strength: "medium", llm, keep: ["river sediments"] });
  assert.equal(r.status, "rewritten");
  assert.equal(r.meaningChecked, true);
  assert.match(r.text, /river sediments/);
  assert.match(r.text, /\(Smith et al\., 2020\)/);
  assert.match(r.text, /94\.2%/);
  assert.match(llm.calls[0]!.system ?? "", /Never use these inflated words/);
});

test("a paraphrase that changes a number is retried, and one that barely changes is sent back once", async () => {
  const llm = fake([
    "The method is key to the analysis {{P1}}, and accuracy reached 95%.",
    "The method plays a crucial role in the analysis of river sediments {{P1}}, and accuracy reached 94.2%.",
    "This method is central to how river sediments are analysed {{P1}}; accuracy reached 94.2%.",
  ]);
  const r = await paraphraseParagraph(PARA, { style: "standard", strength: "medium", llm });
  assert.equal(r.status, "rewritten");
  assert.equal(r.attempts, 3);
  assert.match(r.text, /central to how river sediments are analysed/);
  assert.ok(r.problems.some((p) => /95/.test(p)));
  assert.ok(r.problems.some((p) => /reword more/.test(p)));
});

test("styles and strengths change the instructions", () => {
  assert.match(paraphraseSystemPrompt("shorter", "light"), /a third shorter/);
  assert.match(paraphraseSystemPrompt("academic", "strong"), /Rebuild every sentence/);
});

test("sentence alternatives drop versions that lose a citation or number; synonyms skip the word itself", async () => {
  const llm = fake([
    JSON.stringify({ options: ["Accuracy reached 94.2% {{P1}}.", "Accuracy was high.", "The accuracy was 94.2% {{P1}}."] }),
  ]);
  const alts = await sentenceAlternatives("Accuracy reached 94.2% (Smith et al., 2020).", "", { style: "standard", llm });
  assert.deepEqual(alts, ["The accuracy was 94.2% (Smith et al., 2020)."]);
  const syn = await synonymsInContext("crucial", "It plays a crucial role.", fake([JSON.stringify({ options: ["key", "crucial", "central", "key"] })]));
  assert.deepEqual(syn, ["key", "central"]);
});
