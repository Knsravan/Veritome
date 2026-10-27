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
| Human, non-native research writing | 1.3% of 2,933 wrongly flagged (0.9-1.7%; first samples: 4 of 183, 1 of 42) | 1% or less |
| Human, encyclopedic (Wikipedia before ChatGPT) | 3.0% of 2,352 (2.4-3.7%; first sample: 5 of 155) | 1% or less |
| Human, literature | 0.7% (2 of 306) | 1% or less |
| AI text paraphrased or "humanised" | 12-22% caught (older RAID and MAGE sets) | much higher |
| Separate "AI-paraphrased" category, as Turnitin reports | not possible: no model is trained for it | a third class |

So the biggest risks are **false positives on encyclopedic and, to a lesser degree, non-native writing** and **missing paraphrased or
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

Models (`scripts/train/neural/models.openrouter.json`, all through one OpenRouter key, IDs and prices checked
against OpenRouter's model list on 27 October 2026): OpenAI GPT-6.1 Terra and the cheap GPT-6 Luna, gpt-oss-120b
(the model the detector catches least, 8 of 12), Google Gemini 3.8 Flash, Anthropic Claude Sonnet 5.5, xAI Grok
4.3, DeepSeek V4.1 Flash, Meta Llama 4 Maverick, Qwen 3.8 Flash and Mistral Small; **Z.ai GLM 5.3 Flash is held out
of training** (`"holdout": true`), so every evaluation also reports a model family the detector has never seen.
Each model answers with its default settings, as in its own apps.

Volume: 480 paragraphs per model, 5,280 in all: every collected non-native and encyclopedic human text gets one AI
counterpart on the same topic. `generate.py --dry-run` estimates **about US$14** (Claude Sonnet 5.5 $5.33, GPT-6.1
Terra $2.66, Gemini $2.20, Grok $1.48, the other seven $0.16-0.33 each); reasoning models' thinking is billed as
output and is the main uncertainty, so a first small batch measures the real cost before the full run. Light
polishing is labelled AI-polished but kept out of the "likely AI" training class if it changes less than about a
tenth of the words (as `apt.py` does for APT-Eval), so fixing grammar alone is not called AI writing.

**With Claude and Gemini keys** (27 October 2026: the OpenRouter pilot cost about $0.05 and then stopped, the
account having no credit; the full OpenRouter set would cost about $18): `models.claude-gemini.json` spends little.
Cheap models do most of the work (Gemini 3.8 Flash 1,200 paragraphs, Claude Haiku 5.5 1,200), fewer go to dearer
ones (Claude Sonnet 5.5 600, the earlier Sonnet 4.6 and Haiku 4.5 400 each), and Google's open Gemma 4 models add
1,400 more at no listed cost. The newest models are asked to think at "low", since thinking is billed as output
and does not change how the paragraph reads. About **US$12** for 5,199 paragraphs by the dry-run estimate; a pilot
of three per model (about $0.06) measures the real cost first. This covers the Google and Anthropic families plus
the 30 paragraphs the OpenRouter pilot made (OpenAI, DeepSeek, Llama, Qwen, GLM); the older training sets (MAGE,
RAID, HAP-E) keep other families represented. `models.gemini.json` is a no-cost alternative on Gemini's free tier.

`models.claude.json` does the same with a Claude key alone (five Claude models, about $44), but covers one family
only.

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
