import json, re, glob, random, os
random.seed(3)
MODELS = {0: "sonnet", 1: "haiku", 2: "opus", 3: "sonnet"}
ai = {"train": [], "test": []}
for f in sorted(glob.glob("gen/out/b*.txt")):
    b = int(re.search(r"b(\d+)", f).group(1))
    blocks = re.split(r"^=== ", open(f).read(), flags=re.M)[1:]
    for blk in blocks:
        head, _, body = blk.partition("\n")
        parts = [p.strip() for p in head.split("|")]
        if len(parts) != 3: continue
        id_, kind, split = parts
        text = body.strip()
        if len(text.split()) < 60 or not re.search(r"[.!?)\]\"”]$", text): continue
        if re.match(r"(?i)(here is|here's|sure|certainly)", text): continue
        ai[split].append({"label": "ai", "source": f"acad-{kind}", "model": MODELS.get(b % 4, "?"), "batch": b, "id": id_, "text": " ".join(text.split()[:400])})
hum = [json.loads(l) for l in open("data/human-acad.jsonl")]
tr = [r for r in hum if r["split"] == "train"]; te = [r for r in hum if r["split"] == "test"]
random.shuffle(tr); random.shuffle(te)
def h(r): return {"label": "human", "source": "acad-human", "id": r["id"], "text": " ".join(r["text"].split()[:400])}
with open("data/acad-train.jsonl", "w") as f:
    for r in ai["train"] + [h(r) for r in tr[:9000]]: f.write(json.dumps(r) + "\n")
with open("data/test-acad.jsonl", "w") as f:
    for r in ai["test"] + [h(r) for r in te[:2000]]: f.write(json.dumps(r) + "\n")
print("ai train", len(ai["train"]), "ai test", len(ai["test"]))
