# Human writing for training and testing the AI-writing models

Text written by people before AI writing tools were common, of the two kinds the detector wrongly flagged most often
(see [docs/detector-eval-2026-10-24.md](../../../docs/detector-eval-2026-10-24.md)). One JSON object per line,
gzipped. Every row has `id`, `paper` (the document it came from), `split` (`train` or `test`, decided by the
document, so no held-out document shares text with training text), `text` (150-380 words in one or two
paragraphs) and the attribution its licence asks for.

| File | Rows | Documents | Held out | What | Licence |
|---|---:|---:|---:|---|---|
| `human-esl.jsonl.gz` | 2,933 | 1,913 papers | 611 | Research papers (2012-2021, open access) whose first author works in one of 20 non-English-speaking countries, from Europe PMC; methods sections, tables, figures and formulas left out, citations kept as printed | CC BY, as licensed by each paper; the row gives title, authors, journal, year and PMCID |
| `human-wiki.jsonl.gz` | 2,352 | 1,200 articles | 494 | English Wikipedia articles: 382 rows at their last revision before 2022 (`wiki-pre2022`, with revision id) and 1,970 from the dump of 1 March 2022 (`wiki-20220301`); reference markers, tables, lists and captions left out | CC BY-SA 3.0 (Wikipedia's licence for text of that date); the row gives title and revision or dump |

Neither file overlaps the [TextSight 2026 benchmark](https://huggingface.co/datasets/textsightai/ai-text-detection-benchmark-2026),
which stays a test set only.

These files are data, not code: the MIT licence of this repository does not apply to them. Reuse them under the
licences above, crediting the authors as each row says.

Rebuild or extend them with `scripts/train/neural/human-pmc.py` and `scripts/train/neural/human-wiki.py`; both
continue an existing file rather than starting over.
