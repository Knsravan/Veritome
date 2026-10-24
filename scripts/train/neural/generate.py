# Generates AI-written and AI-edited versions of human paragraphs through any OpenAI-compatible API, for training
# and testing the AI-writing models. Standard library only.
#
#   python generate.py data/human-acad.jsonl gen/ai.jsonl --models models.json [--per-model 400] [--dry-run]
#
# Input rows: {"id", "paper", "split", "text"} (human-chunks.py writes them). Each output row keeps the source's id,
# paper and split, so held-out papers stay held out, and says what was done to it:
#
#   kind      write | polish-light | polish-heavy | paraphrase | humanise | translate
#   category  ai-generated (write) | ai-polished (polish-*, translate) | ai-paraphrased (paraphrase, humanise)
#
# models.json lists the models to use, e.g. with OpenRouter (one key for most providers):
#   [{"name": "gpt-5-mini", "base_url": "https://openrouter.ai/api/v1", "model": "openai/gpt-5-mini",
#     "key_env": "OPENROUTER_API_KEY", "price_in": 0.25, "price_out": 2.0}]
# Prices are US dollars per million tokens, used only for the --dry-run estimate.
#
# Rows already in the output file are skipped, so an interrupted run continues where it stopped.
import argparse, json, os, random, re, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

# The instructions are what people actually type, not "write like an AI". Each model answers in its own default style.
TASKS = {
    "write": ("ai-generated", [
        "Write an original paragraph of about 180-250 words for a research paper on the same topic as this paragraph, as if drafting that section yourself. Do not reuse its sentences.",
        "Using this paragraph only as a topic hint, write a fresh paragraph (about 200 words) that could appear in the introduction or discussion of a paper in this area.",
        "Draft the literature-review paragraph a student would need on this topic, about 200 words, in an academic register.",
    ]),
    "polish-light": ("ai-polished", [
        "Fix the grammar and spelling in this paragraph. Change as little as possible.",
        "Proofread this paragraph for a journal submission. Only correct errors and awkward phrasing.",
    ]),
    "polish-heavy": ("ai-polished", [
        "Polish this paragraph so it reads clearly and professionally for a journal submission.",
        "Improve the academic tone, flow and grammar of this paragraph for an IEEE conference paper.",
        "Refine this paragraph: make it more concise, precise and polished, keeping every point.",
    ]),
    "paraphrase": ("ai-paraphrased", [
        "Paraphrase this paragraph so it says the same thing in different words. Keep the citations.",
        "Rewrite this paragraph in your own words with a different sentence structure, keeping the facts and citations.",
    ]),
    # What "AI humaniser" tools ask for. Labelled AI: the point is to recognise text that was made to evade detection.
    "humanise": ("ai-paraphrased", [
        "Rewrite this paragraph so it sounds like a real person wrote it, not an AI: vary sentence length, use plainer words, avoid stock phrases. Keep the meaning and citations.",
        "Humanize this text so AI detectors won't flag it. Keep it academic and keep every fact and citation.",
    ]),
    # Writers who draft in their own language and have AI translate and polish: common among non-native authors.
    "translate": ("ai-polished", [
        "Translate this paragraph into {lang}.",
    ]),
}
DEFAULT_MIX = {"write": 0.2, "polish-light": 0.15, "polish-heavy": 0.2, "paraphrase": 0.15, "humanise": 0.15, "translate": 0.15}
LANGS = ["Spanish", "Portuguese", "Chinese", "Japanese", "Indonesian", "Hindi", "Arabic", "Turkish"]
SYSTEM = "You are a helpful assistant. Reply with only the resulting paragraph text: no preamble, no notes, no quotation marks."
PREAMBLE = re.compile(r"^(here is|here's|sure|certainly|of course|below is)\b", re.I)


def chat(m, user, temperature=0.8, retries=4):
    key = os.environ.get(m.get("key_env", ""), "")
    body = json.dumps({"model": m["model"], "temperature": temperature, "max_tokens": 900,
                       "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]}).encode()
    for attempt in range(retries + 1):
        req = urllib.request.Request(m["base_url"].rstrip("/") + "/chat/completions", data=body, method="POST",
                                     headers={"content-type": "application/json", **({"authorization": f"Bearer {key}"} if key else {})})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                d = json.load(r)
            text = (d.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            return text, d.get("usage", {})
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == retries: raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries: raise
        time.sleep(2 ** attempt + random.random())


def clean(text):
    """The paragraph alone, or None when the reply is not a usable paragraph."""
    t = text.strip().strip('"“”').strip()
    if PREAMBLE.match(t):
        t = t.split("\n", 1)[1].strip() if "\n" in t else ""
    words = len(t.split())
    if words < 60 or not re.search(r"[.!?)\]\"”]$", t): return None
    return " ".join(t.split()[:400])


def plan(rows, models, per_model, mix, seed):
    """Which paragraph each model gets and what it is asked to do. Each paragraph goes to one model only."""
    rnd = random.Random(seed)
    pool = rows[:]
    rnd.shuffle(pool)
    kinds = list(mix)
    jobs, i = [], 0
    for m in models:
        for _ in range(min(per_model, len(pool) - i)):
            r = pool[i]; i += 1
            kind = rnd.choices(kinds, weights=[mix[k] for k in kinds])[0]
            inst = rnd.choice(TASKS[kind][1])
            lang = rnd.choice(LANGS) if kind == "translate" else None
            jobs.append({"model": m, "row": r, "kind": kind, "instruction": inst.replace("{lang}", lang or ""), "lang": lang})
    return jobs


def run(job):
    m, r, kind = job["model"], job["row"], job["kind"]
    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    def ask(inst, para):
        text, u = chat(m, f"{inst}\n\n{para}")
        for k in usage: usage[k] += u.get(k, 0) or 0
        return text
    if kind == "translate":
        # Draft in another language, then the AI translates it back into English and polishes it, as such a writer would.
        foreign = ask(job["instruction"], r["text"])
        out = ask("Translate this paragraph into English and polish it for an international journal.", foreign)
    else:
        out = ask(job["instruction"], r["text"])
    return clean(out), usage


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input"); ap.add_argument("output")
    ap.add_argument("--models", required=True)
    ap.add_argument("--per-model", type=int, default=400)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--dry-run", action="store_true", help="print the plan and a cost estimate, call nothing")
    a = ap.parse_args()
    models = json.load(open(a.models))
    rows = [json.loads(l) for l in open(a.input) if l.strip()]
    jobs = plan(rows, models, a.per_model, DEFAULT_MIX, a.seed)
    done = set()
    if os.path.exists(a.output):
        done = {(d["id"], d["model"]) for d in map(json.loads, filter(str.strip, open(a.output)))}
    jobs = [j for j in jobs if (j["row"]["id"], j["model"]["name"]) not in done]

    if a.dry_run:
        cost = 0.0
        for j in jobs:
            calls = 2 if j["kind"] == "translate" else 1
            tin = calls * (len(j["row"]["text"].split()) * 1.4 + 80); tout = calls * 330
            cost += (tin * j["model"].get("price_in", 0) + tout * j["model"].get("price_out", 0)) / 1e6
        by = {}
        for j in jobs: by[(j["model"]["name"], j["kind"])] = by.get((j["model"]["name"], j["kind"]), 0) + 1
        for k, v in sorted(by.items()): print(f"{k[0]:28s} {k[1]:14s} {v}")
        print(f"{len(jobs)} requests to make ({len(done)} already done); estimated cost ${cost:.2f}")
        return

    for m in models:
        if m.get("key_env") and not os.environ.get(m["key_env"]):
            sys.exit(f"{m['name']}: set {m['key_env']} first")
    lock = threading.Lock(); kept = failed = 0; spent = {"prompt_tokens": 0, "completion_tokens": 0}
    with open(a.output, "a") as f, ThreadPoolExecutor(a.workers) as pool:
        futures = [(j, pool.submit(run, j)) for j in jobs]
        for n, (j, fut) in enumerate(futures, 1):
            try:
                text, usage = fut.result()
            except Exception as e:  # one failed request must not stop a long run
                failed += 1; print(f"{j['model']['name']} {j['row']['id']}: {type(e).__name__} {e}", file=sys.stderr); continue
            with lock:
                for k in spent: spent[k] += usage[k]
                if not text: failed += 1; continue
                r = j["row"]
                f.write(json.dumps({"label": "ai", "category": TASKS[j["kind"]][0], "kind": j["kind"], "model": j["model"]["name"],
                                    "id": r["id"], "paper": r.get("paper"), "split": r.get("split"), "lang": j["lang"],
                                    "instruction": j["instruction"], "text": text}) + "\n")
                f.flush(); kept += 1
            if n % 50 == 0: print(f"{n}/{len(futures)} kept {kept} failed {failed} tokens {spent}", flush=True)
    print(f"done: kept {kept}, failed or unusable {failed}, tokens {spent}")


if __name__ == "__main__":
    main()
