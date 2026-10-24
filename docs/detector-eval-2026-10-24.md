# AI detector on 2026 models and non-native writing (24 October 2026)

The full pipeline the live site runs (trained classifier plus the two neural models, via
`node scripts/evaluate-detector.ts <file> --neural`), on two sets it was never trained or tuned on.

## TextSight AI-text detection benchmark 2026

[textsightai/ai-text-detection-benchmark-2026](https://huggingface.co/datasets/textsightai/ai-text-detection-benchmark-2026)
(CC BY-SA 4.0): 644 human passages published before ChatGPT (Wikipedia revisions before 2022, PubMed Central papers
by first authors in 12 non-English-speaking countries, public-domain literature) and 56 passages written by five
2026 models, matched in genre and topic to the human ones.

### Full pipeline (as on the site)

| Label / source | n | mean score | likely AI | inconclusive | likely human | too short |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ai / claude-haiku-4-5 | 12 | 94.6 | 100.0% | 0.0% | 0.0% | 0.0% |
| ai / claude-opus-5 | 12 | 92.9 | 100.0% | 0.0% | 0.0% | 0.0% |
| ai / gpt-4.1 | 12 | 87.9 | 91.7% | 8.3% | 0.0% | 0.0% |
| ai / gpt-oss-120b | 12 | 70.2 | 66.7% | 8.3% | 25.0% | 0.0% |
| ai / qwen-3.8-27b | 8 | 81.6 | 87.5% | 0.0% | 12.5% | 0.0% |
| human / human-pmc-esl | 183 | 20.7 | 2.2% | 40.4% | 57.4% | 0.0% |
| human / human-wikipedia-pre2022 | 155 | 30.2 | 3.2% | 54.8% | 41.9% | 0.0% |
| human / pd-literature | 306 | 22.5 | 0.7% | 47.7% | 48.7% | 2.9% |

False-positive rate (human text labelled "likely AI"): 1.7% of 635
Detection rate (AI text labelled "likely AI"): 89.3% of 56
AUROC of the raw score: 0.943

### Classifier alone (without the neural models)

| Label / source | n | mean score | likely AI | inconclusive | likely human | too short |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ai / claude-haiku-4-5 | 12 | 36.1 | 8.3% | 58.3% | 33.3% | 0.0% |
| ai / claude-opus-5 | 12 | 23.7 | 0.0% | 50.0% | 50.0% | 0.0% |
| ai / gpt-4.1 | 12 | 36.6 | 8.3% | 66.7% | 25.0% | 0.0% |
| ai / gpt-oss-120b | 12 | 36.5 | 8.3% | 50.0% | 41.7% | 0.0% |
| ai / qwen-3.8-27b | 8 | 25.6 | 0.0% | 37.5% | 62.5% | 0.0% |
| human / human-pmc-esl | 183 | 19.2 | 0.0% | 42.1% | 57.9% | 0.0% |
| human / human-wikipedia-pre2022 | 155 | 24.0 | 0.0% | 54.8% | 45.2% | 0.0% |
| human / pd-literature | 306 | 23.2 | 0.7% | 50.0% | 46.4% | 2.9% |

False-positive rate (human text labelled "likely AI"): 0.3% of 635
Detection rate (AI text labelled "likely AI"): 5.4% of 56
AUROC of the raw score: 0.613

## Non-native research writing collected for training (sample)

42 chunks from 24 open-access papers (2012-2021) whose first author works in Brazil, Japan or Thailand, collected
with `scripts/train/neural/human-pmc.py`, none in the TextSight set.

| Label / source | n | mean score | likely AI | inconclusive | likely human | too short |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| human / pmc-esl-Brazil | 15 | 9.9 | 0.0% | 26.7% | 73.3% | 0.0% |
| human / pmc-esl-Japan | 16 | 12.1 | 6.3% | 18.8% | 75.0% | 0.0% |
| human / pmc-esl-Thailand | 11 | 11.7 | 0.0% | 36.4% | 63.6% | 0.0% |

False-positive rate (human text labelled "likely AI"): 2.4% of 42
Detection rate (AI text labelled "likely AI"): n/a of 0
AUROC of the raw score: n/a (needs both labels)

## What the wrongly flagged human texts have in common

Of the 11 human TextSight passages labelled likely AI: 5 are encyclopedic Wikipedia text (jazz, plate tectonics,
Baroque music, diabetes, origami), 4 are research writing from Japan, Brazil and Thailand, and 2 are nineteenth-century
fiction in dialogue or dialect. Several carry extraction leftovers (empty "()" where citations were removed, HTML
entities). None of these kinds of human writing is in the neural models' training data.

## The collected human training data, before training on it (24 October 2026)

None of the current models has seen this text, so all of it measures their false positives: 5,285 chunks of
150-380 words (`scripts/train/data/`), scored with the full pipeline. Ranges are 95% Wilson intervals.

| Human writing | n | wrongly labelled likely AI | 95% range | inconclusive | likely human |
|---|---:|---:|---:|---:|---:|
| Research papers by first authors in 20 non-English-speaking countries | 2,933 | 37 (1.3%) | 0.9-1.7% | 16% | 83% |
| Wikipedia before ChatGPT | 2,352 | 70 (3.0%) | 2.4-3.7% | 5% | 92% |
| &nbsp;&nbsp;at the last revision before 2022 | 382 | 13 (3.4%) | 2.0-5.7% | 6% | 90% |
| &nbsp;&nbsp;in the dump of 1 March 2022 | 1,970 | 57 (2.9%) | 2.2-3.7% | 5% | 92% |

By country of the first author. Small groups have wide ranges. Korea (3.6%) and Saudi Arabia (3.8%) are highest and their ranges lie just above the overall rate; with 20 countries compared, one or two that far out is expected by chance, so neither is a firm finding yet:

| Country | n | wrongly labelled likely AI | 95% range | inconclusive | likely human |
|---|---:|---:|---:|---:|---:|
| Egypt | 240 | 1 (0.4%) | 0.1-2.3% | 5% | 94% |
| China | 239 | 2 (0.8%) | 0.2-3.0% | 26% | 73% |
| Germany | 239 | 5 (2.1%) | 0.9-4.8% | 24% | 74% |
| Italy | 209 | 6 (2.9%) | 1.3-6.1% | 18% | 79% |
| India | 201 | 3 (1.5%) | 0.5-4.3% | 15% | 84% |
| Poland | 176 | 0 (0.0%) | 0.0-2.1% | 16% | 84% |
| Japan | 168 | 2 (1.2%) | 0.3-4.2% | 17% | 82% |
| Korea | 168 | 6 (3.6%) | 1.6-7.6% | 18% | 78% |
| Spain | 168 | 2 (1.2%) | 0.3-4.2% | 11% | 88% |
| Brazil | 164 | 0 (0.0%) | 0.0-2.3% | 4% | 96% |
| France | 163 | 1 (0.6%) | 0.1-3.4% | 11% | 88% |
| Turkey | 153 | 0 (0.0%) | 0.0-2.4% | 14% | 86% |
| Iran | 140 | 0 (0.0%) | 0.0-2.7% | 14% | 86% |
| Saudi Arabia | 130 | 5 (3.8%) | 1.7-8.7% | 15% | 81% |
| Nigeria | 95 | 2 (2.1%) | 0.6-7.4% | 17% | 81% |
| Indonesia | 80 | 1 (1.2%) | 0.2-6.7% | 15% | 84% |
| Pakistan | 64 | 1 (1.6%) | 0.3-8.3% | 33% | 66% |
| Thailand | 55 | 0 (0.0%) | 0.0-6.5% | 16% | 84% |
| Mexico | 54 | 0 (0.0%) | 0.0-6.6% | 15% | 85% |
| Vietnam | 27 | 0 (0.0%) | 0.0-12.5% | 33% | 67% |

With 16 times more text than the first samples, non-native research writing comes out at 1.3%, just above the 1%
target (the 183-passage TextSight sample gave 2.2%). Encyclopedic writing is the larger problem at 3.0%, three times
the target, and both ways of collecting it agree.
