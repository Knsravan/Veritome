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
