# Accuracy and limits

Veritome is meant to help you check your own work before someone else does. None of its tools can give a
certain answer, and some (AI-text detection in particular) are known across the field to be unreliable. This page
says what each tool measures, how we tested it, and where it fails.

**The short version:** treat every result as evidence to review, never as a verdict about a person.

## AI-text detector

### What it measures

The detector reports a **0 to 100 score for how strongly the text shows patterns that are common in
language-model output**. It is not a probability that a model wrote the text. Four statistical signals are
combined, each shown to the user with its raw value:

| Signal | What it is | Why it is weak on its own |
| --- | --- | --- |
| Sentence-length variation ("burstiness") | Coefficient of variation of sentence lengths | Formal, edited and non-native writing is often even too |
| Vocabulary variety (MATTR) | Moving-average type-token ratio, 50-word window | Technical writing repeats its key terms by design |
| Stock phrases | Weighted hits from a lexicon of phrases models over-use ("delve into", "plays a pivotal role") | Humans use these too, and newer models avoid them |
| Sentence-opening connectives | Share of sentences opening with "Moreover", "Furthermore", ... | Common in some academic traditions |

Citations, maths, URLs and the reference list are removed before measuring. An optional language-model "judge"
can add its own opinion (35% of the final score by default); when it disagrees with the statistics the
uncertainty band gets wider rather than the disagreement being averaged away. Language models are poorly
calibrated judges of authorship, so this opinion is shown separately.

### Uncertainty bands and verdicts

Every score comes with a band whose width depends on text length and on how much the signals agree.
A verdict is only given when the **whole band** is on one side:

- below 80 words: "Not enough text to judge"
- band entirely at or above 60: "Many patterns typical of model output"
- band entirely at or below 40: "Few signs of model-generated text"
- anything else: "Inconclusive"

This is deliberately conservative. We would rather say "inconclusive" than wrongly flag a person.

Per-sentence highlights use local cues only (stock phrases, opening connectives, runs of equal-length
sentences). They are much noisier than the document score and are labelled as such in the interface.

### How we tested it

`scripts/evaluate-detector.ts` runs the detector over labelled JSONL files and prints false-positive rate,
detection rate and AUROC. The numbers below were produced on 6 October 2026 with the statistical signals only
(no LLM judge):

- **Human text:** 750 passages of about 300 words, all written long before language models existed: 600 from
  the Brown corpus (1961; categories *learned*, *belles-lettres*, *government* and *popular lore*) and 150 from
  the ABC Science corpus, built with `scripts/prepare-human-corpus.py`. The corpora are not redistributed here.
- **Model text:** 16 academic-style paragraphs (about 175 words each) in
  `tests/fixtures/detector-ai-claude.jsonl`, written by a Claude model asked for plain, typical academic prose.
  **Caveat:** the same model also wrote the detector, so this set is small and possibly biased; do not read the
  detection numbers as a benchmark.

| Label / source | n | mean score | likely AI | inconclusive | likely human |
| --- | ---: | ---: | ---: | ---: | ---: |
| model / Claude, plain academic | 16 | 61.1 | 0.0% | 100.0% | 0.0% |
| human / ABC Science | 150 | 32.7 | 0.0% | 82.7% | 17.3% |
| human / Brown *popular lore* | 150 | 27.9 | 0.0% | 58.0% | 42.0% |
| human / Brown *belles-lettres* | 150 | 26.7 | 0.0% | 52.7% | 47.3% |
| human / Brown *government* | 150 | 28.0 | 0.0% | 55.3% | 44.7% |
| human / Brown *learned* | 150 | 33.5 | 0.0% | 78.7% | 21.3% |

- False-positive rate (human text labelled "likely AI"): **0.0% of 750**.
- Detection rate (model text labelled "likely AI"): **0.0% of 16**. Every model passage was "inconclusive".
- AUROC of the raw score, model versus human: **0.973**. The score ranks texts sensibly, but the bands are
  too wide at this length to make a call.
- Human-text score quantiles: median 28, 90th percentile 45, 99th percentile 62, maximum 79.

What this means in practice:

1. On these texts the detector did not falsely accuse anyone. That is the property we optimise for.
2. It also did not confidently catch plain, short model-written paragraphs. Longer texts and texts full of stock
   phrases get confident verdicts; careful model output that has been lightly edited will usually come out
   "inconclusive". That matches published findings for every detector, commercial ones included.
3. 1961 prose is not modern academic writing, and we have not measured non-native English writers, for whom
   published studies show higher false-positive rates with detectors of this kind. Be especially careful there.

### Reproduce or extend

```bash
python3 scripts/prepare-human-corpus.py /path/to/nltk-zips      # writes human.jsonl
node scripts/evaluate-detector.ts tests/fixtures/detector-ai-claude.jsonl /path/to/human.jsonl
node scripts/evaluate-detector.ts my-labelled.jsonl --llm          # also ask the configured LLM
```

Contributions of larger, properly licensed, labelled datasets (especially modern human academic writing and
recent model output) are the most useful thing anyone can add.

## Plagiarism checker

The checker compares your text with titles and abstracts from OpenAlex, Crossref, Semantic Scholar and arXiv,
snippets from optional Brave or Serper web search, and full text of documents you add to your library. It
**cannot read paywalled full texts, theses, student-paper databases or private repositories**, which is where
commercial services such as iThenticate have their advantage. A low score is therefore not proof of
originality. Matches are word-for-word runs (by default at least 8 words, small gaps allowed); close
paraphrase is not detected. Quotations and the reference list are excluded by default.

## Citation checker and finder

Reference verification parses each entry and looks it up by DOI, then by title, in Crossref (and OpenAlex,
DataCite and arXiv where available). It reports *verified*, *likely*, *mismatch*, *not found* or *unchecked*.
"Not found" does not mean fabricated: books, reports, web pages and very new papers are often missing from these
databases. Retraction flags come from Crossref and OpenAlex metadata and can lag behind the publisher.

Citation suggestions are search results ranked by word overlap with your sentence. They are leads to read,
not citations to paste: always check that a paper actually supports the claim.

## Grammar checker

The built-in rules are high-precision checks for common academic-writing problems, a list of frequent
misspellings and readability scores. They are not a full grammar parser. Connecting a LanguageTool server adds
broader grammar and spelling coverage. Readability formulas (Flesch, Flesch–Kincaid) were designed for general
prose and rate most academic writing as "difficult"; use them for comparison between drafts, not as a target.

## Paraphraser and humaniser

Rewrites come from whichever language model you configure. Citations, maths, URLs and cross-references are
replaced with placeholders before the text is sent and restored afterwards, and every number in the output is
compared with the input; rewrites that drop or change a protected item or a number are retried and, if they
still fail, rejected. Meaning can still drift in ways a number check cannot catch, so read every rewrite.

The humaniser shows the detector score before and after. A lower score does not make text "human-written", and
using rewriting to hide undisclosed AI use may break your institution's or publisher's rules. Most publishers
now ask authors to disclose AI assistance; Veritome suggests a disclosure statement for this reason.
