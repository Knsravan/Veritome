# Builds a human-written evaluation set from the Brown and ABC corpora (NLTK data).
# Usage: download brown.zip and abc.zip from https://github.com/nltk/nltk_data (packages/corpora)
# into DIR, then run: python3 scripts/prepare-human-corpus.py DIR  (writes DIR/human.jsonl)

import zipfile, re, json, sys, random
D=sys.argv[1]
random.seed(7)
def detok(words):
    s=" ".join(words)
    s=re.sub(r" ([,.;:?!%)\]])",r"\1",s); s=re.sub(r"([(\[$]) ",r"\1",s)
    s=s.replace("`` ","“").replace(" ''","”").replace("``","“").replace("''","”")
    s=re.sub(r" (n't|'s|'re|'ve|'ll|'d|'m)\b",r"\1",s)
    return s
out=[]
z=zipfile.ZipFile(f"{D}/brown.zip")
for n in sorted(z.namelist()):
    m=re.search(r"/c([a-r])\d\d$",n)
    if not m: continue
    cat=m.group(1)
    if cat not in "jghf": continue  # learned, belles-lettres, government, popular lore
    text=z.read(n).decode("latin-1")
    paras=[]
    for para in re.split(r"\n\s*\n",text):
        toks=[t.rsplit("/",1)[0] for t in para.split() if "/" in t]
        if toks: paras.append(detok(toks))
    # windows of ~300 words made of whole paragraphs
    buf=[]
    for p in paras:
        buf.append(p)
        if sum(len(x.split()) for x in buf)>=300:
            out.append({"label":"human","source":f"brown-{cat}","text":"\n\n".join(buf)}); buf=[]
z=zipfile.ZipFile(f"{D}/abc.zip")
for n in z.namelist():
    if not n.endswith("science.txt"): continue
    text=z.read(n).decode("latin-1")
    sents=[s.strip() for s in text.split("\n") if s.strip()]
    for i in range(0,len(sents)-15,15):
        out.append({"label":"human","source":"abc-science","text":" ".join(sents[i:i+15])})
random.shuffle(out)
by={}
for r in out: by.setdefault(r["source"],[]).append(r)
sel=[]
for k,v in by.items(): sel+=v[:150]
with open(f"{D}/human.jsonl","w") as f:
    for r in sel: f.write(json.dumps(r)+"\n")
print({k:min(len(v),150) for k,v in by.items()})

