import json, random
random.seed(11)
rows=[json.loads(l) for l in open("data/human-acad.jsonl")]
tr=[r for r in rows if r["split"]=="train"]; te=[r for r in rows if r["split"]=="test"]
random.shuffle(tr); random.shuffle(te)
POLISH=["Polish this paragraph so it reads clearly and professionally for a journal submission.",
"Improve the academic tone, flow and grammar of this paragraph for an IEEE conference paper.",
"Refine this paragraph: make it more concise, precise and polished, keeping every point.",
"Edit this paragraph to sound like a well-written research paper. Keep the meaning and citations.",
"Improve this paragraph's clarity and readability for a thesis chapter."]
REWRITE=["Rewrite this paragraph in your own words with better structure, keeping the facts and citations.",
"Paraphrase and restructure this paragraph so it argues its point more persuasively."]
WRITE=["Write an original paragraph of about 180-250 words for a research paper on the same topic as this paragraph, as if drafting that section yourself. Do not reuse its sentences.",
"Using this paragraph only as a topic hint, write a fresh paragraph (about 200 words) that could appear in the introduction or discussion of a paper in this area."]
def task():
    x=random.random()
    if x<0.5: return "polish", random.choice(POLISH)
    if x<0.7: return "rewrite", random.choice(REWRITE)
    return "write", random.choice(WRITE)
B=28; per=40
for b in range(B):
    pool = te if b%7==0 else tr   # 4 batches from held-out papers
    items=[pool.pop() for _ in range(per)]
    with open(f"gen/in/b{b:02d}.txt","w") as f:
        for r in items:
            kind,inst=task()
            f.write(f"=== {r['id']} | {kind} | {r['split']}\nINSTRUCTION: {inst}\nPARAGRAPH:\n{r['text']}\n\n")
print("ok")
