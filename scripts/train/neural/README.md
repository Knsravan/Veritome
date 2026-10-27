# Training the neural AI-writing model

The second AI-writing opinion is a small transformer (ELECTRA-small, 14M parameters, about 14 MB after int8
quantisation) that runs in the browser with ONNX Runtime Web (`src/lib/ai-model`). It was added because the
hashed-phrase classifier caught almost none of the human-written, AI-*polished* research text that Turnitin flags.

## Data

| Part | Human | AI |
|---|---|---|
| peS2o research papers published before June 2022 (`allenai/peS2o` v2, s2orc) | 3,500 paragraphs | about 850 written, rewritten or polished by current Claude models from the same papers (twice weighted) |
| APT-Eval (`smksaha/apt-eval`, ACL 2025), polished by GPT-4o, DeepSeek-V3, Llama 3/3.1 and Llama 2 | originals and ≤5% / "extreme minor" polish | ≥35% / "slight major" and "major" polish |
| HAP-E academic genre (`browndw/human-ai-parallel-corpus`) | 855 | 2,565 (GPT-4o-mini, Llama 3) |
| MAGE scientific writing (`yaful/MAGE`) | 1,500 | 1,500 |
| Other human genres (HAP-E blog/news/fiction/spoken, Brown corpus) | about 1,400 | – |

Papers and APT originals are split by document, so no held-out text shares a source with training text.

## Next round

[docs/detector-training-plan.md](../../../docs/detector-training-plan.md) is the plan for the next training round. Two
scripts for it are ready:

- `python human-pmc.py data/human-esl.jsonl --exclude textsight-pmc.jsonl` collects human research writing by
  authors in non-English-speaking countries (open-access, CC BY, 2012-2021) from Europe PMC, in the same chunk format
  as `human-chunks.py`.
- `python human-wiki.py data/human-wiki.jsonl --exclude textsight-wiki.jsonl` does the same for encyclopedic writing:
  random English Wikipedia articles as they stood before 2022, without reference markers, tables or captions.
- `python generate.py data/human-acad.jsonl gen/ai.jsonl --models models.json --dry-run` plans AI versions of those
  paragraphs (written, polished, translated, paraphrased, "humanised") across any OpenAI-compatible models, prints the
  cost, and without `--dry-run` makes them. It replaces the manual batch steps 2-3 below. `models.openrouter.json`
  lists eleven models from ten companies behind one `OPENROUTER_API_KEY` (about US$14 for 480 paragraphs each by the
  dry-run estimate; GLM is held out for testing). With the key stored as the `OPENROUTER_API_KEY` repository
  secret, the **Generate AI training text** workflow (Actions tab, run by hand) does this on GitHub and pushes the
  rows to the `data/ai-generation` branch; start with `per_model` 5 for a pilot that reports the real cost per model.
  `models.gemini.json` (repository secret `GEMINI_API_KEY`) uses Gemini's free tier: run it once a day until done.
  `models.claude.json` reads the `ANTHROPIC_API_KEY` secret. Claude models can also go through
  Anthropic's SDK (`pip install anthropic`); `models.claude.json` lists five current and earlier ones, read the key
  from `VERITOME_ANTHROPIC_KEY` (not `ANTHROPIC_API_KEY`, which coding agents and other tools may use for their own
  access), and cost about US$44 for 1,000 paragraphs each by the dry-run estimate (about $21 without Opus).

## Steps (from a scratch directory with `data/`, `ft/` and `nn/`)

1. `python human-chunks.py` cuts peS2o papers into 150–380-word chunks (`data/human-acad.jsonl`).
2. `python make-batches.py` writes batches of 40 chunks, each with a polish / rewrite / write instruction.
   Each batch is given to a language model with: *"follow its INSTRUCTION on its PARAGRAPH exactly as you naturally
   would if a user had asked you that in a chat, and produce only the resulting paragraph text … Write naturally in
   your own default style — do not try to sound human or to evade detection."*
3. `python collect-generated.py` turns the answers into `data/acad-train.jsonl` and `data/test-acad.jsonl`.
4. `python apt.py` adds APT-Eval.
5. `DATA=train2.jsonl LR=1e-4 python finetune.py google/electra-small-discriminator es2 1.5 256`
   (random 150–200-word windows, batch 16, about 90 minutes on 4 CPU cores).
6. `optimum-cli export onnx --model es2 --task text-classification es2-onnx`, then
   `onnxruntime.quantization.quantize_dynamic(..., weight_type=QInt8)` to `es2-onnx/onnx/model_quantized.onnx`.
7. `python calibrate.py es2-onnx calib.json && python report.py calib.json` scores the held-out sets exactly as the
   browser does (180-word windows, 256 tokens, averaged) and prints the thresholds for about 1% and 0.5% false
   positives on human text. They go into `public/models/ai-writing/meta.json`, together with each model's
   `sha256` (the first 16 hex digits of the file's SHA-256, `sha256sum model-a.onnx | cut -c1-16`). Browsers keep a
   model for a year under that fingerprint, so a replaced model must get its new one; `npm test` fails until it does.
8. The whole-paper test (`document` in `meta.json`) was set on 300 held-out human peS2o papers: share of prose
   paragraphs above the 90th human percentile, level at the 99th percentile of papers (0.55, minimum six paragraphs).
