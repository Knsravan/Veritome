| Label / source | n | mean score | likely AI | inconclusive | likely human | too short |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ai / ai: GPT-4 (MAGE out-of-distribution) | 400 | 74.3 | 36.3% | 54.0% | 0.8% | 9.0% |
| ai / ai: GPT-4 then paraphrased | 300 | 54.5 | 12.3% | 76.7% | 6.7% | 4.3% |
| ai / ai: GPT-4o (unseen model) | 300 | 80.0 | 49.7% | 49.3% | 1.0% | 0.0% |
| ai / ai: Llama-3-70B-Instruct | 300 | 93.2 | 86.3% | 13.3% | 0.3% | 0.0% |
| ai / ai: MAGE scientific writing | 172 | 59.6 | 19.8% | 49.4% | 6.4% | 24.4% |
| ai / ai: RAID, attack=homoglyph | 150 | 83.0 | 56.7% | 37.3% | 0.7% | 5.3% |
| ai / ai: RAID, attack=none | 150 | 84.4 | 62.7% | 32.7% | 1.3% | 3.3% |
| ai / ai: RAID, attack=paraphrase | 150 | 69.5 | 22.0% | 65.3% | 0.7% | 12.0% |
| ai / ai: RAID, attack=perplexity_misspelling | 150 | 74.8 | 40.7% | 55.3% | 2.0% | 2.0% |
| ai / ai: RAID, attack=synonym | 150 | 79.2 | 49.3% | 47.3% | 2.0% | 1.3% |
| ai / ai: RAID, attack=zero_width_space | 150 | 76.3 | 52.0% | 46.7% | 1.3% | 0.0% |
| ai / claude-plain | 16 | 47.1 | 0.0% | 93.8% | 6.3% | 0.0% |
| human / human: Brown 1961 / ABC Science (held-out half) | 375 | 7.8 | 0.0% | 20.3% | 79.7% | 0.0% |
| human / human: HAP-E acad | 98 | 21.4 | 0.0% | 57.1% | 42.9% | 0.0% |
| human / human: HAP-E blog | 90 | 22.8 | 2.2% | 52.2% | 45.6% | 0.0% |
| human / human: HAP-E fic | 106 | 12.8 | 0.0% | 30.2% | 69.8% | 0.0% |
| human / human: HAP-E news | 104 | 16.2 | 0.0% | 43.3% | 56.7% | 0.0% |
| human / human: HAP-E spok | 130 | 18.2 | 0.0% | 43.8% | 56.2% | 0.0% |
| human / human: HAP-E tvm | 72 | 12.3 | 0.0% | 31.9% | 68.1% | 0.0% |
| human / human: MAGE scientific writing | 228 | 18.2 | 0.0% | 43.0% | 50.9% | 6.1% |
| human / human: RAID | 200 | 28.4 | 0.5% | 64.5% | 34.0% | 1.0% |

False-positive rate (human text labelled "likely AI"): 0.2% of 1387
Detection rate (AI text labelled "likely AI"): 46.4% of 2261
AUROC of the raw score: 0.954
