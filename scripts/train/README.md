# Training the AI-pattern classifier

The shipped model (`src/core/detector/model-weights.ts`) is a logistic regression over hashed word and phrase
features plus 20 style measurements, all computed by `src/core/detector/features.ts`. Training data is featurised by
that same TypeScript code, so the app and the training pipeline cannot disagree.

Steps (run from a scratch directory containing a `data/` folder; Python needs scikit-learn, pandas and pyarrow):

1. Download MAGE (`yaful/MAGE`: train.csv, test.csv, test_ood_set_gpt*.csv) and HAP-E
   (`browndw/human-ai-parallel-corpus` parquet files) from Hugging Face into `data/`, prefixed `mage_` and `hape_`.
2. `python assemble.py` builds `data/train.jsonl` and the held-out test sets (GPT-4o is never used for training;
   30% of HAP-E documents are held out).
3. `python sample-raid.py data/raid-test2.jsonl 0` and `python sample-raid.py data/raid-train-raw.jsonl 0.5` read
   slices of the RAID training file; drop train rows whose `sid` appears in the test sample.
4. Human prose from before language models: `scripts/prepare-human-corpus.py`, split in halves (train / test).
5. `node scripts/train/featurize.ts in.jsonl out.svm` for every file; concatenate the training files to `train2.svm`.
6. `python train.py 4` trains (C=4, human texts weighted 1.5) and scores the test sets; `python calibrate.py` picks the
   "likely AI" threshold for about 1% false positives on half of the held-out human texts and reports on the other half.
7. `python scripts/train/export-model.py model_final.npy dense_norm.npy <likelyAi> <likelyHuman> "<description>"`.

Results of the current model are in `docs/ACCURACY.md`.
