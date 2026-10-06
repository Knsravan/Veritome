import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFixes, checkGrammar, checkGrammarLocal, mergeIssues } from "../../src/core/grammar/check.ts";
import { checkWithLanguageTool } from "../../src/core/grammar/languagetool.ts";
import { startsWithVowelSound } from "../../src/core/grammar/rules.ts";
import { createHttp } from "../../src/core/infra/http.ts";
import type { Issue, SpellChecker } from "../../src/core/grammar/types.ts";
import { jsonResponse, mockFetch, noSleep } from "./helpers.ts";

const rulesFor = (text: string, options = {}) => checkGrammarLocal(text, options).issues.map((i) => i.rule);
const find = (text: string, rule: string, options = {}) => checkGrammarLocal(text, options).issues.filter((i) => i.rule === rule);

test("repeated words are flagged but legitimate repeats are not", () => {
  const hit = find("The the results were clear.", "repeated-word");
  assert.equal(hit.length, 1);
  assert.deepEqual(hit[0]?.suggestions, ["The"]);
  assert.equal(find("She said that that approach had had little effect.", "repeated-word").length, 0);
});

test("a/an agreement handles exceptions and initialisms", () => {
  assert.equal(find("This is a apple.", "a-an")[0]?.suggestions[0], "an");
  assert.equal(find("We need an university.", "a-an")[0]?.suggestions[0], "a");
  assert.equal(find("It took an hour.", "a-an").length, 0);
  assert.equal(find("It was a unique result and an honest one.", "a-an").length, 0);
  assert.equal(find("We used an NSF grant and a CNN model.", "a-an").length, 0);
  assert.equal(find("We used a NSF grant.", "a-an").length, 1);
  assert.equal(find("An MRI scan and a NASA report.", "a-an").length, 0);
  assert.equal(startsWithVowelSound("one"), false);
  assert.equal(startsWithVowelSound("umbrella"), true);
});

test("confusions such as 'should of' and 'more then'", () => {
  const f = find("We should of checked. The model is better then the baseline.", "confused-words");
  assert.equal(f.length, 2);
  assert.equal(f[0]?.suggestions[0], "should have");
  assert.equal(f[1]?.suggestions[0], "better than");
  assert.equal(find("It applies to many studies and too many people.", "confused-words").length, 0);
});

test("wordy phrases offer shorter alternatives and keep capitalisation", () => {
  const f = find("In order to proceed, due to the fact that it failed, a large number of cases remain.", "wordy-phrase");
  assert.deepEqual(
    f.map((x) => x.suggestions[0]),
    ["To", "because", "many"],
  );
  const cut = find("It is important to note that the sample was small.", "wordy-phrase");
  assert.equal(cut.length, 1);
  assert.deepEqual(cut[0]?.suggestions, []);
});

test("informal wording and contractions are academic-category info", () => {
  const f = checkGrammarLocal("We don't know a lot of things, and it's gonna change.").issues;
  const informal = f.filter((i) => i.rule === "informal-wording").map((i) => i.text.toLowerCase());
  assert.ok(informal.includes("a lot of"));
  assert.ok(informal.includes("gonna"));
  const contraction = f.filter((i) => i.rule === "contraction");
  assert.deepEqual(
    contraction.map((c) => c.suggestions[0]),
    ["do not", "it is"],
  );
  assert.ok(f.every((i) => i.category !== "spelling"));
});

test("long sentences are flagged by word count", () => {
  const long = Array.from({ length: 45 }, (_, i) => `word${i}`).join(" ") + ".";
  assert.equal(find(long, "long-sentence")[0]?.severity, "warning");
  const veryLong = Array.from({ length: 70 }, (_, i) => `word${i}`).join(" ") + ".";
  assert.equal(find(veryLong, "long-sentence")[0]?.severity, "error");
  assert.equal(find("Short and sweet.", "long-sentence").length, 0);
});

test("punctuation spacing rules", () => {
  assert.equal(find("This works , but not here.", "space-before-punctuation").length, 1);
  assert.equal(find("This works,but not here.", "missing-space-after-punctuation").length, 1);
  assert.equal(find("It ended.Then it began.", "missing-space-after-punctuation").length, 1);
  assert.equal(find("Values of 1,000 and 3.14 are fine; see Fig.3 and e.g. this.", "missing-space-after-punctuation").length, 0);
  assert.equal(find("Two  spaces here.", "double-space").length, 1);
  assert.equal(find("    indented line is fine.", "double-space").length, 0);
});

test("unbalanced brackets and quotes", () => {
  assert.equal(find("This (is open and never closed.", "unbalanced-brackets").length, 1);
  assert.equal(find("This is closed) without opening.", "unbalanced-brackets").length, 1);
  assert.equal(find("Fine (nested [brackets]) here.", "unbalanced-brackets").length, 0);
  assert.equal(find('He said "hello and left.', "unbalanced-quotes").length, 1);
  assert.equal(find("1) First point\n2) Second point", "unbalanced-brackets").length, 0);
});

test("citations, maths and URLs are never analysed", () => {
  const text = "As shown by (Smith  & Lee , 2020) and [1,2] with $a  b$ at https://example.org/a_b?x=1 the effect holds.";
  const issues = checkGrammarLocal(text).issues;
  assert.equal(issues.length, 0, JSON.stringify(issues));
});

test("sentence capitalisation after a full stop and at paragraph start", () => {
  assert.equal(find("It worked. the next step failed.", "sentence-capital").length, 1);
  assert.equal(find("This was shown by Smith et al. the approach", "sentence-capital").length, 0);
  assert.equal(find("See e.g. the appendix.", "sentence-capital").length, 0);
  assert.equal(find("First paragraph here.\n\nthe second starts lowercase.", "sentence-capital").length, 1);
});

test("mixed British and American spelling flags the minority variety", () => {
  const text = "We analyse the colour data. The organization will analyze the colour results. We analyse again.";
  const f = find(text, "mixed-spelling-variety");
  const flagged = f.map((x) => x.text.toLowerCase());
  assert.ok(flagged.includes("organization") || flagged.includes("analyze"));
  assert.ok(f.every((x) => x.severity === "warning"));
  assert.equal(find("We analyse the colour data and the behaviour.", "mixed-spelling-variety").length, 0);
});

test("acronyms must be defined", () => {
  const undefinedText = "The XYZ method improves recall. XYZ is fast and XYZ is robust.";
  assert.equal(find(undefinedText, "undefined-acronym").length, 1);
  const defined = "The Cross Yield Zone (XYZ) method improves recall. XYZ is fast.";
  assert.equal(find(defined, "undefined-acronym").length, 0);
  assert.equal(find(defined, "acronym-before-definition").length, 0);
  const before = "XYZ is fast. The Cross Yield Zone (XYZ) method improves recall.";
  assert.equal(find(before, "acronym-before-definition").length, 1);
  assert.equal(find("The DNA and the USA, PDF files and HTML.", "undefined-acronym").length, 0);
});

test("passive voice is only reported when it dominates", () => {
  const mostlyActive = "We ran the test. We measured the gain. We compared the groups. The data was cleaned. We report the results.";
  assert.equal(find(mostlyActive, "passive-voice").length, 0);
  const mostlyPassive =
    "The samples were collected. The data was analysed. The model was trained. The results were validated. We report them.";
  assert.ok(find(mostlyPassive, "passive-voice").length >= 3);
});

test("repeated sentence starts and numerals at the start", () => {
  const text = "The model works. The data agree. The results hold. Another point follows.";
  assert.equal(find(text, "repeated-sentence-start").length, 1);
  assert.equal(find("50 participants completed every session in the lab.", "number-at-start").length, 1);
});

test("spelling: built-in list works without a dictionary", () => {
  const f = find("We recieve the seperate results definately.", "spelling");
  assert.deepEqual(
    f.map((x) => x.suggestions[0]),
    ["receive", "separate", "definitely"],
  );
  assert.equal(find("Recieve the results.", "spelling")[0]?.suggestions[0], "Receive");
});

test("spelling: dictionary integration respects names, repeats, ignores and masks", () => {
  const known = new Set(["the", "model", "results", "were", "good", "and", "worked", "then", "agreed"]);
  const checker: SpellChecker = {
    isCorrect: (w) => known.has(w.toLowerCase()),
    suggest: (w) => (w === "modle" ? ["model", "mode"] : []),
  };
  const text = "The modle results were good. Zorblax and Zorblax and Zorblax worked. Then Nguyen agreed (Qwxzt, 2020). Plugh worked.";
  const f = find(text, "spelling", { spellChecker: checker, ignoreWords: ["plugh"] });
  const words = f.map((x) => x.text);
  assert.ok(words.includes("modle"));
  assert.deepEqual(f.find((x) => x.text === "modle")?.suggestions, ["model", "mode"]);
  assert.ok(!words.includes("Zorblax"), "words repeated 3+ times are treated as terms");
  assert.ok(!words.includes("Nguyen"), "capitalised mid-sentence words are treated as names");
  assert.ok(!words.includes("Qwxzt"), "citation contents are masked");
  assert.ok(!words.includes("Plugh"), "ignore list is honoured");
});

test("disabled rules are skipped and summary counts add up", () => {
  const text = "We use a apple. We don't know. Due to the fact that it failed we stop.";
  const all = checkGrammarLocal(text);
  assert.ok(all.issues.some((i) => i.rule === "contraction"));
  const without = checkGrammarLocal(text, { disabledRules: ["contraction"] });
  assert.ok(!without.issues.some((i) => i.rule === "contraction"));
  const s = all.summary;
  assert.equal(s.total, all.issues.length);
  assert.equal(s.bySeverity.error + s.bySeverity.warning + s.bySeverity.info, s.total);
  assert.ok(s.score >= 0 && s.score <= 100);
});

test("readability metrics are plausible", () => {
  const easy = checkGrammarLocal("The cat sat. The dog ran. We like it.").metrics;
  const hard = checkGrammarLocal(
    "Notwithstanding considerable methodological heterogeneity, epidemiological investigations consistently demonstrate multifactorial aetiological determinants.",
  ).metrics;
  assert.ok(easy.fleschReadingEase > hard.fleschReadingEase);
  assert.ok(easy.fleschKincaidGrade < hard.fleschKincaidGrade);
  assert.equal(easy.sentences, 3);
  assert.equal(checkGrammarLocal("").metrics.words, 0);
});

test("clean academic prose scores high", () => {
  const text =
    "We evaluated three optimisation strategies on a public benchmark. Each strategy was run ten times with different seeds. " +
    "The second strategy converged fastest, whereas the first produced the most stable results. Differences were small but consistent (Wang et al., 2021).";
  const r = checkGrammarLocal(text);
  assert.ok(r.summary.score >= 85, `score ${r.summary.score}: ${JSON.stringify(r.issues.map((i) => i.rule))}`);
});

test("applyFixes applies non-overlapping fixes and reports skipped ones", () => {
  const text = "We use a apple and teh model.";
  const r = applyFixes(text, [
    { start: 7, end: 8, replacement: "an" },
    { start: 19, end: 22, replacement: "the" },
    { start: 7, end: 12, replacement: "overlaps" },
  ]);
  assert.equal(r.text, "We use an apple and the model.");
  assert.equal(r.applied, 2);
  assert.equal(r.skipped, 1);
});

test("LanguageTool: maps matches, chunks long text and reports failures", async () => {
  const body = {
    matches: [
      {
        message: "Possible agreement error.",
        offset: 3,
        length: 4,
        replacements: [{ value: "have" }, { value: "has" }],
        rule: { id: "HAVE_PART_AGREEMENT", issueType: "grammar", category: { id: "GRAMMAR" } },
      },
    ],
  };
  const { fetch, calls } = mockFetch(() => jsonResponse(body));
  const http = createHttp({ fetch, sleep: noSleep });
  const text = "He have been there. It is fine.";
  const r = await checkWithLanguageTool(text, { url: "http://lt.local:8010/", http, picky: true });
  assert.equal(calls[0]?.url, "http://lt.local:8010/v2/check");
  assert.match(calls[0]?.body ?? "", /level=picky/);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0]?.text, "have");
  assert.equal(r.issues[0]?.severity, "error");
  assert.deepEqual(r.issues[0]?.suggestions, ["have", "has"]);

  const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
  const chunked = mockFetch(() => jsonResponse({ matches: [] }));
  await checkWithLanguageTool(long, { url: "http://lt.local", http: createHttp({ fetch: chunked.fetch, sleep: noSleep }), maxChunkChars: 200 });
  assert.ok(chunked.calls.length > 2);

  const down = mockFetch(() => jsonResponse({}, 500));
  const failed = await checkWithLanguageTool(text, {
    url: "http://lt.local",
    http: createHttp({ fetch: down.fetch, sleep: noSleep, retries: 0 }),
  });
  assert.equal(failed.issues.length, 0);
  assert.match(failed.warning ?? "", /could not be reached/);
});

test("checkGrammar merges LanguageTool results and survives it being down", async () => {
  const text = "We use a apple. He have been there.";
  const lt = mockFetch(() =>
    jsonResponse({
      matches: [{ message: "Agreement", offset: 19, length: 4, replacements: [{ value: "has" }], rule: { id: "X", issueType: "grammar", category: { id: "GRAMMAR" } } }],
    }),
  );
  const merged = await checkGrammar(text, { languageTool: { url: "http://lt", http: createHttp({ fetch: lt.fetch, sleep: noSleep }) } });
  assert.ok(merged.issues.some((i) => i.source === "languagetool"));
  assert.ok(merged.issues.some((i) => i.rule === "a-an"));

  const down = mockFetch(() => {
    throw new Error("ECONNREFUSED");
  });
  const fallback = await checkGrammar(text, {
    languageTool: { url: "http://lt", http: createHttp({ fetch: down.fetch, sleep: noSleep, retries: 0 }) },
  });
  assert.ok(fallback.issues.some((i) => i.rule === "a-an"));
  assert.equal(fallback.warnings.length, 1);
});

test("mergeIssues prefers LanguageTool on overlapping grammar spans only", () => {
  const mk = (rule: string, cat: Issue["category"], start: number, end: number, source: Issue["source"]): Issue => ({
    id: `${rule}:${start}`,
    rule,
    category: cat,
    severity: "error",
    message: "",
    start,
    end,
    text: "",
    suggestions: [],
    source,
  });
  const local = [mk("a-an", "grammar", 0, 5, "veritome"), mk("wordy-phrase", "clarity", 0, 5, "veritome")];
  const remote = [mk("lt:X", "grammar", 2, 8, "languagetool")];
  const merged = mergeIssues(local, remote);
  assert.deepEqual(merged.map((m) => m.rule).sort(), ["lt:X", "wordy-phrase"]);
});

test("rulesFor helper sanity", () => {
  assert.ok(rulesFor("Fine text.").length === 0);
});

test("academic confusions: agreement, countables, its/it's, affect/effect, et al.", () => {
  const cases: Array<[string, string]> = [
    ["The results shows a clear trend.", "results show"],
    ["This study show a clear trend.", "This study shows"],
    ["We recruited less participants than planned.", "fewer participants"],
    ["The amount of participants was small.", "The number of participants"],
    ["Its been shown before.", "It's been"],
    ["The affect of temperature was strong.", "The effect of"],
    ["As Smith et al reported, the effect holds.", "et al."],
    ["The principle investigator approved it.", "principal investigator"],
    ["We used complimentary methods.", "complementary methods"],
    ["This phenomena is rare.", "This phenomenon"],
  ];
  for (const [text, fix] of cases) {
    const issue = checkGrammarLocal(text).issues.find((i) => i.rule === "confused-words");
    assert.ok(issue, `no issue for: ${text}`);
    assert.equal(issue.suggestions[0], fix, text);
  }
});

test("then/than after a comparative is a warning that points at 'then'", () => {
  const text = "The comparison rests on fewer samples then we planned.";
  const issue = checkGrammarLocal(text).issues.find((i) => i.rule === "likely-confusion");
  assert.equal(issue?.severity, "warning");
  assert.equal(issue?.text, "then");
  assert.deepEqual(issue?.suggestions, ["than"]);
  assert.equal(checkGrammarLocal("We collected more samples, then we analysed them.").issues.filter((i) => i.rule === "likely-confusion").length, 0);
});

test("correct academic sentences raise no confusion issues", () => {
  const text =
    "These results show a clear trend. The study shows that its own method works. Fewer participants than expected took part. " +
    "The effect of temperature was strong, and it affects growth. The principal component explained most variance.";
  assert.deepEqual(checkGrammarLocal(text).issues.filter((i) => i.rule === "confused-words" || i.rule === "likely-confusion"), []);
});
