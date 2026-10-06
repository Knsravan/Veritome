import numpy as np, json, collections
probs = np.load("probs.npy", allow_pickle=True).item()
meta = {
    "mage-test": "data/test-mage-test.jsonl", "test_ood_set_gpt": "data/test-test_ood_set_gpt.jsonl", "test_ood_set_gpt_para": "data/test-test_ood_set_gpt_para.jsonl",
    "hape-test": "data/test-hape-test.jsonl", "brown-abc": "data/brown-test.jsonl", "claude": "/home/user/Veritome/tests/fixtures/detector-ai-claude.jsonl", "raid": "data/raid.jsonl",
}
rows = {k: [json.loads(l) for l in open(v) if l.strip()] for k, v in meta.items()}
# Calibration: even-indexed human texts of every set; reporting uses odd-indexed ones.
cal = np.concatenate([p[(y == 0) & (np.arange(len(y)) % 2 == 0)] for p, y in probs.values()])
def thr_for(fpr): return float(np.quantile(cal, 1 - fpr))
t_ai = thr_for(0.01); t_hum = float(np.quantile(cal, 0.5))
print("calibration humans", len(cal), "likelyAi threshold (1% FPR)", round(t_ai, 4), "| 0.5% ->", round(thr_for(0.005), 4))
def word_count(t): return len(t.split())
out = {}
for k, (p, y) in probs.items():
    idx = np.arange(len(y)); hum = (y == 0) & (idx % 2 == 1); ai = y == 1
    r = {"n_human_report": int(hum.sum()), "fpr": round(float((p[hum] >= t_ai).mean()), 4) if hum.any() else None,
         "n_ai": int(ai.sum()), "tpr": round(float((p[ai] >= t_ai).mean()), 4) if ai.any() else None}
    out[k] = r; print(k.ljust(22), r)
# Breakdowns
p, y = probs["raid"]; by = collections.defaultdict(list)
for i, m in enumerate(rows["raid"]):
    if y[i] == 1: by[("attack", m["attack"])].append(p[i] >= t_ai); by[("model", m["model"])].append(p[i] >= t_ai)
print("RAID detection by attack/model:"); [print("  ", k, round(float(np.mean(v)), 3), len(v)) for k, v in sorted(by.items())]
p, y = probs["hape-test"]; by = collections.defaultdict(list)
for i, m in enumerate(rows["hape-test"]):
    if y[i] == 1: by[m["source"].split("-", 2)[2]].append(p[i] >= t_ai)
    else: by["human-" + m["source"].split("-")[1]].append(p[i] >= t_ai)
print("HAP-E by model / human genre (flag rate):"); [print("  ", k, round(float(np.mean(v)), 3), len(v)) for k, v in sorted(by.items())]
p, y = probs["mage-test"]; by = collections.defaultdict(list)
for i, m in enumerate(rows["mage-test"]):
    by[("human" if y[i] == 0 else "ai", m["source"].replace("mage-test-", ""))].append(p[i] >= t_ai)
print("MAGE flag rate by label/domain:"); [print("  ", k, round(float(np.mean(v)), 3), len(v)) for k, v in sorted(by.items())]
json.dump({"t_ai": t_ai, "t_hum": t_hum, "results": out}, open("calib.json", "w"))
