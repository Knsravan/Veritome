# Accuracy and limits

Veritome is meant to help you check your own work before someone else does. None of its tools can give a
certain answer, and some (AI-text detection in particular) are known across the field to be unreliable. This page
says what each tool measures, how we tested it, and where it fails.

**The short version:** treat every result as evidence to review, never as a verdict about a person.

## AI-text detector

### What it measures

The score (0 to 100) is a trained classifier's estimate of how strongly the text resembles machine-written text it
has seen. It is **not** proof of authorship. The model is a logistic regression over hashed word and phrase
features, function-word patterns and 20 style measurements, trained on about 90,000 labelled texts:

| Training data | What it adds |
| --- | --- |
| MAGE (Li et al., 2024; Apache-2.0) | 27 models from GPT-2 to GPT-3.5 across 10 kinds of writing, including scientific text |
| HAP-E (Reinhart et al., 2024; MIT) | Human text and Llama-3 / GPT-4o-mini continuations of the same openings, incl. academic writing |
| RAID sample (Dugan et al., 2024; MIT) | 11 newer models and evasion attacks, sources disjoint from the RAID test sample |
| Brown 1961 and ABC Science (half) | Human prose written before language models existed |

Before scoring, lookalike letters from other alphabets and invisible characters (two common tricks for fooling
checkers) are undone, and their presence is reported. Citations, maths and the reference list are left out. Long
texts are scored in overlapping windows of about 300 words, so mixed authorship shows up section by section.

The four hand-built style measurements from the first version (sentence-length variation, vocabulary variety,
stock phrases, opening connectives) are still shown to explain the text, but they no longer decide the result.
An optional language-model opinion is shown separately and can only widen the uncertainty range.

### Verdicts

- below 80 words: "Not enough text to judge"
- score at or above **86**: "Many patterns typical of model output". This threshold was set so that about 1 in 100
  human texts in a calibration set reaches it. Texts under 150 words need 93.
- score at or below **15**: "Few patterns typical of model output"
- anything else: "Inconclusive"

### How well it works

Measured on 6 October 2026 on texts **never used in training or for choosing the threshold**, through the full
app pipeline (`docs/detector-eval-2026-10-06.md` has every row):

| Human-written text | n | wrongly labelled AI |
| --- | ---: | ---: |
| Brown 1961 and ABC Science (held-out half) | 375 | 0% |
| HAP-E academic writing | 98 | 0% |
| MAGE scientific writing | 228 | 0% |
| HAP-E news, fiction, speech, TV, blogs | 502 | 0.4% |
| RAID (various domains) | 200 | 0.5% |
| **All human text** | **1,387** | **0.2%** |

| Machine-written text | n | labelled AI | labelled human |
| --- | ---: | ---: | ---: |
| Llama-3-70B-Instruct | 300 | 86% | 0.3% |
| GPT-4o (model never seen in training) | 300 | 50% | 1.0% |
| GPT-4 (MAGE out-of-distribution set) | 400 | 36% | 0.8% |
| RAID, no attack | 150 | 63% | 1.3% |
| RAID, lookalike-letter attack | 150 | 57% | 0.7% |
| RAID, synonym attack | 150 | 49% | 2.0% |
| RAID, zero-width-space attack | 150 | 52% | 1.3% |
| RAID, misspelling attack | 150 | 41% | 2.0% |
| RAID, paraphrase attack | 150 | 22% | 0.7% |
| GPT-4, then paraphrased | 300 | 12% | 6.7% |
| MAGE scientific writing (older models) | 172 | 20% | 6.4% |
| 16 paragraphs written by a Claude model for this project | 16 | 0% | 6% |
| **All machine text** | **2,261** | **46%** | |

AUROC of the raw score over all of these: **0.954** (the first rule-based version scored about 0.5 on unseen
data, that is, no better than chance). Raw-model AUROC on the full held-out sets: HAP-E 0.995, RAID 0.924, MAGE
0.899, MAGE GPT-4 0.898, MAGE paraphrased 0.770.

### Which parts of a paper read as AI-written

The plagiarism page also reports an **AI writing percentage**: the share of the text in paragraphs that read as
likely AI-written. Paragraphs are scored separately (short ones joined until a segment has at least 150 words, with
the stricter short-text bar below 150), so one machine-written paragraph is not averaged away by its human
neighbours. In a check of 764 such segments built from 790 Europe PMC abstracts published between 2005 and 2019
(before AI writing tools), **2 (0.26%)** were wrongly marked as likely AI-written; 2 of 263 three-paragraph
documents (0.8%) had any part marked. A machine-written paragraph that the whole-text score had averaged down to
"inconclusive" scored 0.997 on its own.

### What this means in practice

1. **False accusations are rare.** In these tests, about 1 human text in 500 was labelled AI, and none of the
   academic or scientific ones. Still, never treat a verdict as proof.
2. **It misses a lot of machine text.** About half of machine-written text is labelled AI; most of the rest is
   "inconclusive", rarely "human". Paraphrasing defeats it more often than not. This is the price of keeping
   false positives low, and it is true of every detector: commercial ones that report higher detection rates
   usually also flag more human text.
3. **Unseen models are harder.** Models not represented in the training data (here Claude, Cohere and GPT-3)
   are detected less often. The model will need retraining as new language models appear.
4. **Not yet measured:** non-native English academic writing, where published studies show detectors of this
   kind flag more human text. Be especially careful there.

Reproduce or retrain with the steps in `scripts/train/README.md`, or measure on your own labelled data with
`node scripts/evaluate-detector.ts your.jsonl`.

## Plagiarism checker

### What it searches

| Source | What it can see | Key needed |
| --- | --- | --- |
| arXiv | Abstracts of about 2.5 million preprints, searched by exact phrase | No |
| Europe PMC | Abstracts of 45 million life-science papers and the **full text** of about 10 million open-access ones | No |
| Wikipedia | Full text of matching articles | No |
| Crossref | Titles, and abstracts where publishers deposit them | No (contact email recommended) |
| OpenAlex | Titles and abstracts of about 250 million works, plus full text where OpenAlex has it, searched by exact phrase first | Free key, effectively required |
| Semantic Scholar | Titles and abstracts; with a key also full-text snippets | Optional |
| CORE | **Full text** of 30+ million open-access papers | Free key |
| Brave or Serper | Web search snippets (Brave's free plan: 2,000 searches a month, so at most 30 per check) | Free tier, then paid |
| Your library | Full text of documents you add | No |

The text is cut into consecutive chunks of whole sentences (short sentences are joined), and every chunk is
searched when there are no more than 40 chunks; longer texts are sampled evenly across their length, up to 40 searches.
Every document found is then compared with the whole text, so one hit on a copied section finds all of it. Matches are word-for-word runs (by default at least 6 words, with gaps of up to 2 edited words
bridged). **Reworded sentences** are reported separately: a sentence is flagged when a source sentence shares
most of its ideas after folding word forms and common academic synonyms together ("demonstrate" and "show",
"approach" and "framework"). They are not counted in the main percentage.

A run shorter than 10 words is dropped as a stock phrase ("the association between air pollution and") unless
that source shares at least 15 words with the text in total, or the run makes up at least half of its sentence.
Each matched passage is credited to one source only (the one sharing most of it, the oldest on a tie), so the
source percentages add up to the overall score; other sources containing the same words are listed separately.
Each passage is also marked **cited** or **not cited**, from in-text citations in the same sentence, and quotations
without a citation are listed even though they are left out of the score.

### Measured accuracy (7 October 2026)

`node scripts/evaluate-plagiarism.ts --live 30` builds cases from 377 Europe PMC abstracts in 12 fields: half
serve as published sources, half as the author's own writing, and each case hides one source sentence (or none)
inside original text. The full output is in [plagiarism-eval-2026-10-07.md](plagiarism-eval-2026-10-07.md).

| Case | Found | Credited to the right source | Cited or not judged right |
| --- | ---: | ---: | ---: |
| Copied word for word (187) | 99.5% | 95.2% | 99.5% |
| Copied, followed by a citation (187) | 99.5% | 95.2% | 100% |
| Copied with every 6th word changed or dropped (187) | 100% | 95.7% | 99.5% |
| Lightly reworded, 3+ synonym swaps (11) | 100% | 100% | – |
| Original text only (185): any match at all | 4.9% | – | – |

Most "wrong source" cases and most matches on original text turned out to be the same abstract published twice
(a preprint and the journal version, or a conference supplement), which a reader would want to know about. The
rest were near-identical methods sentences from related papers by the same groups. Before the stock-phrase rule
and the rewording threshold were added, 19.6% of original texts had a match.

**Live search** (Crossref and Europe PMC only, no keys, 30 copied sentences): **97%** found (29 of 30), up from
30% before every sentence was searched (plain sentences used to be skipped as not distinctive enough); on the live site OpenAlex phrase search and Brave web search add to this. The sources
in this test are Europe PMC abstracts, which favours Europe PMC.

Limits of this test: the rewordings are mechanical, which is easier than a person or a language model
paraphrasing freely, and abstracts are not full papers.

### Live test (6 October 2026)

A 96-word paragraph containing one sentence pair copied from the ResNet abstract (with one word dropped) and one
sentence copied from the body of the Transformer paper, mixed with original sentences, was checked against the
live services without any API keys:

- Before this round of work: **0%** (the arXiv search was broken and Crossref holds few abstracts).
- After: **52%**, which is exactly the copied share. The ResNet sentences were traced to the ResNet paper on arXiv;
  the Transformer sentence was found through Europe PMC full text in papers that quote it.

False alarms for reworded sentences: 127 sentences written independently on six research topics were compared
with 120 arXiv abstracts on the same topics. **None** was flagged.

### What it still cannot see

Paywalled full texts that are not open access, theses, student-paper databases and private repositories, which is
where commercial services such as iThenticate have their advantage. A low score is therefore not proof of
originality. Heavier rewriting than synonym swaps and reordering, and text translated from another language,
can still slip through. Quotations and the reference list are excluded by default.

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
