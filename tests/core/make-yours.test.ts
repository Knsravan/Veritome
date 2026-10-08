import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatRequest, LlmClient } from "../../src/core/llm/client.ts";
import { makeYoursQuestions, makeYoursWeave } from "../../src/core/rewrite/make-yours.ts";

function fake(replies: string[], checkOk: boolean | boolean[] = true): LlmClient & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  let r = 0;
  let c = 0;
  return {
    model: "fake",
    calls,
    async chat(req) {
      calls.push(req);
      if (req.json && /check an edit/.test(req.system)) {
        const ok = Array.isArray(checkOk) ? checkOk[Math.min(c++, checkOk.length - 1)] : checkOk;
        return JSON.stringify({ ok, problems: ok ? [] : ["it adds a reason the author did not give"] });
      }
      return replies[Math.min(r++, replies.length - 1)] ?? "";
    },
  };
}

const PARA = "The system was evaluated extensively and showed strong performance across many scenarios (Lee, 2021).";

test("questions are parsed, trimmed to three and tied to quoted words", async () => {
  const llm = fake([
    JSON.stringify({
      questions: [
        { quote: "evaluated extensively", question: "How did you evaluate it?", why: "names the test" },
        { quote: "strong performance", question: "What did you measure?", why: "gives the result" },
        { quote: "many scenarios", question: "Which scenarios?", why: "makes it concrete" },
        { quote: "x", question: "Fourth?", why: "" },
      ],
    }),
  ]);
  const qs = await makeYoursQuestions(PARA, llm);
  assert.equal(qs.length, 3);
  assert.equal(qs[0]!.quote, "evaluated extensively");
  assert.match(llm.calls[0]!.system, /only they can answer/);
});

test("the author's answers, including their numbers, are written in with citations kept", async () => {
  const llm = fake(["We tested the system on 40 sensor logs from two rivers, and it caught 37 of the 40 floods {{P1}}."]);
  const r = await makeYoursWeave(PARA, [{ question: "How did you evaluate it?", answer: "on 40 sensor logs from two rivers, it caught 37 of the 40 floods" }], {
    tone: "academic",
    llm,
  });
  assert.equal(r.status, "rewritten");
  assert.match(r.text, /\(Lee, 2021\)/);
  assert.match(r.text, /37 of the 40/);
});

test("a number nobody said, or a check that finds invented content, is rejected; with no answers nothing changes", async () => {
  const invented = fake(["We tested it on 40 logs and reached 99% accuracy {{P1}}."]);
  const r1 = await makeYoursWeave(PARA, [{ question: "q", answer: "we tested it on 40 logs" }], { tone: "natural", llm: invented, retries: 0 });
  assert.equal(r1.status, "kept_original");
  assert.match(r1.problems.join(" "), /99/);
  const embellished = fake(["We tested it on 40 logs because the old method was too slow {{P1}}."], false);
  const r2 = await makeYoursWeave(PARA, [{ question: "q", answer: "we tested it on 40 logs" }], { tone: "natural", llm: embellished, retries: 0 });
  assert.equal(r2.status, "kept_original");
  const none = await makeYoursWeave(PARA, [{ question: "q", answer: "  " }], { tone: "natural", llm: fake([""]) });
  assert.equal(none.text, PARA);
});
