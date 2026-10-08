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
   positives on human text. They go into `public/models/ai-writing/meta.json`.
