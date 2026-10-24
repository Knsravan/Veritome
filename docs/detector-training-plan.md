# AI detector: training-data plan

Goal: get as close to commercial detectors (Turnitin, Grammarly) as open data and a small budget allow, without giving
up the rule that matters most: **about 1 in 100 human texts or fewer wrongly flagged, in every kind of human writing
we test**, not just on average.

## Where we stand (24 October 2026)

Measured with the full site pipeline (`node scripts/evaluate-detector.ts <file> --neural`); details in
[detector-eval-2026-10-24.md](detector-eval-2026-10-24.md).

| | Result | Target |
|---|---|---|
| Text by 2026 models (Claude Opus 5 and Haiku 4.5, GPT-4.1, gpt-oss-120b, Qwen 3.8) | 89% caught (50 of 56) | keep, raise gpt-oss and other open models (67%) |
| Human, non-native research writing | 2.2% (4 of 183) and 2.4% (1 of 42) wrongly flagged | 1% or less |
| Human, encyclopedic (pre-2022 Wikipedia) | 3.2% (5 of 155) | 1% or less |
| Human, literature | 0.7% (2 of 306) | 1% or less |
| AI text paraphrased or "humanised" | 12-22% caught (older RAID and MAGE sets) | much higher |
| Separate "AI-paraphrased" category, as Turnitin reports | not possible: no model is trained for it | a third class |

So the biggest risks are **false positives on non-native and encyclopedic writing** and **missing paraphrased or
humanised AI text**, not catching plain output from current models.

## Step 1. Human writing the models have never seen (no cost)

| Data | Script | Why |
|---|---|---|
| Research papers by first authors in 20 non-English-speaking countries, 2012-2021, CC BY, from Europe PMC: **collected**, 2,933 chunks from 1,913 papers (`scripts/train/data/human-esl.jsonl.gz`) | `scripts/train/neural/human-pmc.py` | the group detectors most often wrong |
| Wikipedia before ChatGPT (CC BY-SA 3.0): **collected**, 2,352 chunks from 1,200 articles (`scripts/train/data/human-wiki.jsonl.gz`) | `scripts/train/neural/human-wiki.py` | encyclopedic text reads like model output |
| peS2o research papers before June 2022 (existing) | `human-chunks.py` | native and mixed academic writing |
| Text as it arrives from PDFs and Word files: citation markers, hyphenation, stray entities | augmentation in `make-batches` step | extraction leftovers were in several false positives |

All human data is split by paper: no held-out paper shares text with training text. The TextSight benchmark is
excluded from collection and kept as a test set only.

## Step 2. AI writing from the models people use now (needs an API key)

`scripts/train/neural/generate.py` sends the same human paragraphs (from step 1) to many models through any
OpenAI-compatible API and records what was asked. Pairing each AI text with the human paragraph it came from means
the model cannot learn the topic instead of the writing.

| Kind | Share | Labelled | What it covers |
|---|---:|---|---|
| write | 20% | ai-generated | a fresh paragraph on the paper's topic |
| polish-light | 15% | ai-polished | grammar and spelling only |
| polish-heavy | 20% | ai-polished | "make it read professionally" |
| translate | 15% | ai-polished | drafted in another language, then translated and polished by AI (common among non-native authors) |
| paraphrase | 15% | ai-paraphrased | the same content in other words |
| humanise | 15% | ai-paraphrased | "make it sound human / undetectable", as humaniser tools do |

Models: one current model from each of OpenAI, Google (Gemini), Anthropic (Claude), DeepSeek, Meta (Llama), Alibaba
(Qwen), Mistral and an open-weight GPT (gpt-oss), plus at least one cheap "mini" model, since students use free
tiers. One OpenRouter key reaches all of them. **One whole model family is held out of training** so every evaluation
also reports a model the detector has never seen.

Volume: about 1,500 paragraphs per model, 12,000 in all. `generate.py --dry-run` prints the exact cost for the
chosen models before anything is spent; with mostly mid-priced models it is roughly US$15-30, and up to about $80
if the most expensive frontier models are included. Light polishing is labelled AI-polished but kept out of the
"likely AI" training class if it changes less than about a tenth of the words (as `apt.py` does for APT-Eval),
so fixing grammar alone is not called AI writing.

## Step 3. Train (needs a GPU for a few hours)

1. Keep the current browser model (ELECTRA-small) as is, retrained on the new data with a third class
   (human / AI / AI-paraphrased), so the browser check stays private and fast.
2. Train a larger model (DeBERTa-v3-base, about ten times the parameters) for a server-side check. A free Colab
   T4 or any cloud GPU is enough: roughly one to two hours for this amount of data.
3. Set the "likely AI" level on human writing only, and per kind of human writing: it must stay at or under 1% on
   *each* human set, not just overall.

## Step 4. Ship only if it is better everywhere

A new model replaces the current one only if, on held-out data:

- human false positives are at or under 1% on each set: peS2o, non-native PMC (ours and TextSight's), Wikipedia,
  HAP-E, MAGE, RAID and literature;
- detection is no lower than now on any existing AI set, and higher on paraphrased and humanised text;
- the held-out model family is caught at least as well as now;
- the result on the two Turnitin-checked papers does not get worse (and more such papers are added; see below).

Results go into `docs/ACCURACY.md` with the date, as before.

## What is needed

- **An API key** (OpenRouter is simplest) with a spending limit, for step 2.
- **A GPU** for step 3 (Colab or a cloud machine), or permission to run training on one.
- **Papers with a known history and a Turnitin AI report**, ideally including some by non-native authors, and some
  where only grammar was fixed. These are the only way to measure ourselves against Turnitin directly; two papers
  are all we have.
