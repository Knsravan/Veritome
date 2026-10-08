import json, random, sys, time, torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification, get_linear_schedule_with_warmup
torch.set_num_threads(4); torch.manual_seed(0); random.seed(0)
BASE, OUT = sys.argv[1], sys.argv[2]; EPOCHS = float(sys.argv[3]); ML = int(sys.argv[4])
rows = [json.loads(l) for l in open(__import__("os").environ.get("DATA","train.jsonl"))]
tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForSequenceClassification.from_pretrained(BASE, num_labels=2)
opt = torch.optim.AdamW(model.parameters(), lr=float(__import__("os").environ.get("LR","1e-4")), weight_decay=0.01)
BS = 16; steps = int(len(rows) / BS * EPOCHS)
sch = get_linear_schedule_with_warmup(opt, int(steps * 0.06), steps)
# Random 256-token windows of each text so the model sees different parts.
def window(t):
    w = t.split()
    if len(w) > 200:
        s = random.randint(0, len(w) - 200); w = w[s:s + random.randint(150, 200)]
    return " ".join(w)
model.train(); t0 = time.time(); step = 0
while step < steps:
    random.shuffle(rows)
    for i in range(0, len(rows) - BS + 1, BS):
        b = rows[i:i + BS]
        enc = tok([window(r["text"]) for r in b], truncation=True, max_length=ML, padding=True, return_tensors="pt")
        out = model(**enc, labels=torch.tensor([r["label"] for r in b]))
        out.loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step(); sch.step(); opt.zero_grad(); step += 1
        if step % 50 == 0: print(step, steps, round(out.loss.item(), 4), f"{time.time()-t0:.0f}s", flush=True)
        if step >= steps: break
model.save_pretrained(OUT); tok.save_pretrained(OUT); print("saved", OUT)
