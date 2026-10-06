import pandas as pd, json, hashlib, random, sys
random.seed(13)
D = "data/"
def trunc(t, n=400):
    w = str(t).split()
    return " ".join(w[:n])
def write(path, rows):
    with open(path, "w") as f:
        for r in rows: f.write(json.dumps(r) + "\n")
    print(path, len(rows))
train, tests = [], {}
# MAGE: stratified subsample of train; test subsample; OOD sets kept whole.
m = pd.read_csv(D + "mage_train.csv")
m = m[m.text.astype(str).str.split().str.len() >= 40]
m["dom"] = m.src.str.split("_").str[0]
for (dom, lab), g in m.groupby(["dom", "label"]):
    k = min(len(g), 3500 if lab == 1 else 3500)
    for _, r in g.sample(k, random_state=1).iterrows():
        train.append({"label": "human" if r.label == 1 else "ai", "source": f"mage-{dom}", "text": trunc(r.text)})
t = pd.read_csv(D + "mage_test.csv"); t = t[t.text.astype(str).str.split().str.len() >= 40]
t["dom"] = t.src.str.split("_").str[0]
tests["mage-test"] = [{"label": "human" if r.label == 1 else "ai", "source": f"mage-test-{r.dom}", "text": trunc(r.text)} for _, r in t.sample(8000, random_state=2).iterrows()]
for name in ["test_ood_set_gpt", "test_ood_set_gpt_para"]:
    o = pd.read_csv(D + f"mage_{name}.csv")
    tests[name] = [{"label": "human" if r.label == 1 else "ai", "source": name, "text": trunc(r.text)} for _, r in o.iterrows()]
# HAP-E: human continuation (chunk-2) vs model continuations; split documents; GPT-4o held out from training.
human = pd.read_parquet(D + "hape_human-chunk-2.parquet")
human["doc"] = human.doc_id.str.split("@").str[0]
def is_test(doc): return int(hashlib.md5(doc.encode()).hexdigest(), 16) % 10 < 3
models = ["gpt-4o-2024-08-06", "gpt-4o-mini-2024-07-18", "llama-3-70B-Instruct", "llama-3-8B-Instruct"]
hape_test = []
for _, r in human.iterrows():
    row = {"label": "human", "source": f"hape-{r.doc.split('_')[0]}", "text": trunc(r.text)}
    (hape_test if is_test(r.doc) else train).append(row)
for mod in models:
    g = pd.read_parquet(D + f"hape_{mod}.parquet"); g["doc"] = g.doc_id.str.split("@").str[0]
    for _, r in g.iterrows():
        row = {"label": "ai", "source": f"hape-{r.doc.split('_')[0]}-{mod}", "text": trunc(r.text)}
        if is_test(r.doc): hape_test.append(row)
        elif not mod.startswith("gpt-4o-2024"): train.append(row)
tests["hape-test"] = hape_test
random.shuffle(train)
write("data/train.jsonl", train)
for k, v in tests.items(): write(f"data/test-{k}.jsonl", v)
