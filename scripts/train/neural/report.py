import json, sys, numpy as np
d = json.load(open(sys.argv[1]))
ev = d["eval"]; apt = d["apt"]; pp = d["papers"]
HUM = ["acad-human", "hape-human", "mage-human", "brown-human", "raid-human"]
hum = np.array([r["p"] for r in ev if r["set"] in HUM] + [r["p"] for r in apt if r["set"].endswith("original")])
for q in [0.99, 0.995]:
    t = float(np.quantile(hum, q)); th = float(np.quantile(hum, 0.5))
    print(f"\n=== likelyAi={t:.4f} (human FPR {1-q:.1%}), likelyHuman(median human)={th:.4f}")
    for s in HUM: print(f"  FPR {s:12s} {np.mean([r['p']>=t for r in ev if r['set']==s]):.3f}")
    for s in ["acad-ai", "hape-ai", "raid-ai"]: print(f"  TPR {s:12s} {np.mean([r['p']>=t for r in ev if r['set']==s]):.3f}")
    by = {}
    for r in apt:
        if r["set"].endswith("original"): continue
        lvl = r["set"].rsplit("-", 1)[1]; by.setdefault(lvl, []).append(r["p"] >= t)
    print("  APT polished, flagged by level:", {k: round(float(np.mean(v)), 2) for k, v in sorted(by.items())})
    for paper in ["tii", "tii2"]:
        rr = [r for r in pp if r["set"] == paper and r["prose"]]
        W = sum(r["words"] for r in rr); tiiw = sum(r["tii"] * r["words"] for r in rr)
        us = sum(r["words"] for r in rr if r["p"] >= t); caught = sum(r["tii"] * r["words"] for r in rr if r["p"] >= t)
        agree = sum(r["words"] for r in rr if (r["p"] >= t) == (r["tii"] >= 0.5))
        print(f"  {paper}: Turnitin {tiiw/W:.0%} | ours {us/W:.0%} | caught {caught/max(tiiw,1):.0%} of Turnitin's | agree {agree/W:.0%}")
