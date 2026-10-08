import json, random, re, hashlib
random.seed(5)
out=[]
for line in open("data/pes2o_s2orc.jsonl"):
    d=json.loads(line)
    if str(d.get("created",""))[:7] >= "2022-06": continue
    paras=[p.strip() for p in re.split(r"\n+", d["text"]) if len(p.split())>=25]
    paras=paras[1:]  # drop title/abstract line mix
    good=[p for p in paras if sum(ch.isdigit() for ch in p)/max(1,len(p))<0.04 and not re.search(r"(\b\w\b ){6,}", p) and "�" not in p]
    buf=[]; k=0
    for p in good:
        buf.append(p)
        w=sum(len(x.split()) for x in buf)
        if w>=150:
            if w<=380: out.append({"id":f"{d['id']}-{k}","paper":d["id"],"text":"\n\n".join(buf)}); k+=1
            buf=[]
        if k>=3: break
random.shuffle(out)
# keep at most 2 chunks per paper for diversity
seen={}; sel=[]
for r in out:
    if seen.get(r["paper"],0)>=2: continue
    seen[r["paper"]]=seen.get(r["paper"],0)+1; sel.append(r)
for r in sel: r["split"]="test" if int(hashlib.md5(r["paper"].encode()).hexdigest(),16)%10<2 else "train"
with open("data/human-acad.jsonl","w") as f:
    for r in sel: f.write(json.dumps(r)+"\n")
print(len(sel), sum(r["split"]=="test" for r in sel))
print(sel[0]["text"][:600]); print("---"); print(sel[1]["text"][:600])
