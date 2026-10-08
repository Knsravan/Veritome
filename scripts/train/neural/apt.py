# Builds training and test rows from APT-Eval (smksaha/apt-eval: human texts polished by five LLMs).
# Polished texts are matched to their originals by word overlap; 20% of originals (and all their polished
# versions) are held out. Heavy polishing ("major", "slight_major", >= 35%) is labelled AI, very light polishing
# ("extreme_minor", <= 5%) human, and the levels in between are left out of training.
import pandas as pd, json, random, hashlib, re, collections
random.seed(9)
m = pd.read_csv("data/apt/merged.csv"); o = pd.read_csv("data/apt/original.csv")
tok = lambda t: set(re.findall(r"[a-z]+", str(t).lower()))
O = [(r.id, r.domain, tok(r.generation)) for r in o.itertuples()]
def orig(r):
    t = tok(r.generation)
    return max((len(t & ot) / max(1, len(t | ot)), oid) for oid, dom, ot in O if dom == r.domain)[1]
m["orig"] = [orig(r) for r in m.itertuples()]
test = lambda oid: int(hashlib.md5(str(oid).encode()).hexdigest(), 16) % 5 == 0
def lab(r):
    if r.polish_type == "degree-based": return {"major": "ai", "slight_major": "ai", "extreme_minor": "human"}.get(r.polishing_degree)
    return "ai" if r.polishing_percent >= 35 else ("human" if r.polishing_percent <= 5 else None)
tr, te = [], []
for r in m.itertuples():
    l = lab(r)
    level = r.polishing_degree if r.polish_type == "degree-based" else int(r.polishing_percent)
    row = {"text": r.generation, "label": l, "src": f"apt-{r.domain}-{r.polisher}-{level}"}
    if test(r.orig): te.append(row)
    elif l: tr.append(row)
for r in o.itertuples():
    (te if test(r.id) else tr).append({"text": r.generation, "label": "human", "src": f"apt-{r.domain}-original"})
open("ft/apt-train.jsonl", "w").writelines(json.dumps({"text": r["text"], "label": 1 if r["label"] == "ai" else 0}) + "\n" for r in tr)
open("nn/apt-test.jsonl", "w").writelines(json.dumps({"set": r["src"], "label": r["label"] or "mixed", "text": r["text"]}) + "\n" for r in te)
print("train", collections.Counter(r["label"] for r in tr), "test", len(te))
