import csv, io, json, re, sys, urllib.request, collections
URL = "https://huggingface.co/datasets/liamdugan/raid/resolve/main/train.csv"
SIZE = 11779491051
N, CHUNK = 60, 3_000_000
OFF = float(sys.argv[2])
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12},", re.M)
csv.field_size_limit(10**8)
cols = "id,adv_source_id,source_id,model,decoding,repetition_penalty,attack,domain,title,prompt,generation".split(",")
out = open(sys.argv[1], "w")
stats = collections.Counter()
for k in range(N):
    start = int(SIZE * (k + OFF) / N)
    req = urllib.request.Request(URL, headers={"Range": f"bytes={start}-{start + CHUNK}"})
    try:
        data = urllib.request.urlopen(req, timeout=180).read().decode("utf-8", "ignore")
    except Exception as e:
        print("fail", k, e, file=sys.stderr); continue
    m = UUID.search(data, 1 if k else 0)
    if not m: continue
    body = data[m.start():]
    rows = list(csv.reader(io.StringIO(body)))[:-1]  # last row is cut off
    for r in rows:
        if len(r) != len(cols): continue
        d = dict(zip(cols, r))
        if d["domain"] not in ("abstracts", "wiki", "news", "reddit", "books", "reviews", "recipes", "poetry"): continue
        if d["decoding"] not in ("", "sampling", "greedy"): continue
        text = d["generation"].replace("\n", " ")
        if len(text.split()) < 60: continue
        # Keep a diverse, manageable sample: at most 40 rows per (domain, model, attack) per chunk.
        key = (d["domain"], d["model"], d["attack"], k)
        if stats[key] >= 40: continue
        stats[key] += 1
        out.write(json.dumps({"label": "human" if d["model"] == "human" else "ai", "source": f"raid-{d['domain']}", "model": d["model"], "attack": d["attack"], "sid": d["source_id"], "text": " ".join(text.split()[:400])}) + "\n")
    print(k, len(rows), file=sys.stderr)
agg = collections.Counter()
for (dom, mod, att, _), v in stats.items(): agg[(mod, att)] += v
print(sorted(agg.items())[:80], file=sys.stderr)
