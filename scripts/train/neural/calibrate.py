import json, sys, numpy as np, onnxruntime as ort, re
from transformers import AutoTokenizer
D = sys.argv[1]  # exported model dir
tok = AutoTokenizer.from_pretrained(D)
sess = ort.InferenceSession(D + "/onnx/model_quantized.onnx", providers=["CPUExecutionProvider"])
def windows(t, n=180):
    w = t.split()
    if len(w) <= n: return [" ".join(w)]
    out = []; step = int(n * 0.8)
    for i in range(0, len(w), step):
        out.append(" ".join(w[i:i + n]))
        if i + n >= len(w): break
    return out
def score(t):
    ps = []
    for w in windows(t):
        e = tok(w, truncation=True, max_length=256, return_tensors="np")
        l = sess.run(None, {k: e[k].astype(np.int64) for k in ["input_ids", "attention_mask", "token_type_ids"]})[0][0]
        ps.append(1 / (1 + np.exp(l[0] - l[1])))
    return float(np.mean(ps))
def prose(t):
    toks = t.split(); return len(toks) >= 40 and sum(bool(re.fullmatch(r"[(\"“]?[A-Za-z][a-z'’-]+[,.;:)\"”]*", x)) for x in toks) / len(toks) >= 0.6
out = {}
for name, f in [("eval", "eval.jsonl"), ("apt", "apt-test.jsonl"), ("papers", "papers2.jsonl")]:
    rows = [json.loads(l) for l in open(f)]
    out[name] = [dict(set=r["set"], label=r["label"], tii=r.get("tii"), words=r.get("words"), prose=prose(r["text"]), p=score(r["text"])) for r in rows]
    print(name, len(rows), flush=True)
json.dump(out, open(sys.argv[2], "w"))
