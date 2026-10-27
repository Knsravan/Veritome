# Generates AI-written and AI-edited versions of human paragraphs through any OpenAI-compatible API or Anthropic's
# Claude API, for training and testing the AI-writing models. Standard library only, plus the `anthropic` package
# for Claude models (pip install anthropic).
#
#   python generate.py data/human-acad.jsonl gen/ai.jsonl --models models.json [--per-model 400] [--dry-run]
#
# Input rows: {"id", "paper", "split", "text"} (human-chunks.py writes them). Each output row keeps the source's id,
# paper and split, so held-out papers stay held out, and says what was done to it:
#
#   kind      write | polish-light | polish-heavy | paraphrase | humanise | translate
#   category  ai-generated (write) | ai-polished (polish-*, translate) | ai-paraphrased (paraphrase, humanise)
#
# models.json lists the models to use, e.g. with OpenRouter (one key for most providers; models.openrouter.json):
#   [{"name": "gpt-6-luna", "base_url": "https://openrouter.ai/api/v1", "model": "openai/gpt-6-luna",
#     "key_env": "OPENROUTER_API_KEY", "price_in": 0.10, "price_out": 0.50, "est_out": 900}]
# Sampling is left at each model's default (what people get in its apps; many current models reject temperature),
# unless an entry sets "temperature". "max_tokens" defaults to 8000 so reasoning models, which count their thinking
# against it, still finish the paragraph. "extra" is merged into the request body as is (for example OpenRouter's
# {"reasoning": {"effort": "low"}}). "holdout": true marks a model whose rows are for testing only, never training,
# so every evaluation includes a model family the detector has not learned.
# Claude models go through the official SDK instead ("provider": "anthropic"; no base_url needed):
#   [{"name": "claude-haiku-5-5", "provider": "anthropic", "model": "claude-haiku-5-5",
#     "key_env": "VERITOME_ANTHROPIC_KEY", "effort": "low", "price_in": 0.10, "price_out": 0.50, "est_out": 600}]
# Prices are US dollars per million tokens, used only for the --dry-run estimate. "est_out" is the expected output
# tokens per request (default 330, a paragraph); current Claude models think before answering and thinking is billed
# as output, so give them more. "effort" (low, medium, high) is optional and sets how much they think.
# Each row records the model that actually wrote it ("served_by"), which can differ from the one asked: a request
# Claude Opus 5.5 or Sonnet 5.5 declines is re-run on Anthropic's recommended fallback model.
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


# Claude models whose declined requests Anthropic re-runs on a fallback model server-side. Haiku has no fallback.
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"}
_clients, _clients_lock = {}, threading.Lock()


def anthropic_client(key):
    with _clients_lock:
        if key not in _clients:
            import anthropic  # only needed for Claude models
            # This process may run where ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN belong to something else (a coding
            # agent's own session, say); the SDK would read them, so they are dropped here and the address is explicit.
            for k in ("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"): os.environ.pop(k, None)
            _clients[key] = anthropic.Anthropic(api_key=key, base_url="https://api.anthropic.com", max_retries=6)
        return _clients[key]


def chat_anthropic(m, user):
    """One Claude request: (paragraph text, usage, model that wrote it). A refusal returns no text."""
    client = anthropic_client(os.environ[m["key_env"]])
    # No temperature: current Claude models reject sampling parameters. Thinking stays at the model's default, as in
    # Claude's own apps; 16,000 tokens leaves room for it so a paragraph is never cut off.
    params = {"model": m["model"], "max_tokens": 16000, "system": SYSTEM, "messages": [{"role": "user", "content": user}]}
    if m.get("effort"): params["output_config"] = {"effort": m["effort"]}
    if m["model"] in FALLBACK_MODELS:
        r = client.beta.messages.create(**params, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    else:
        r = client.messages.create(**params)
    usage = {"prompt_tokens": r.usage.input_tokens, "completion_tokens": r.usage.output_tokens}
    if r.stop_reason == "refusal":
        print(f"{m['name']}: declined ({getattr(r.stop_details, 'category', None)})", file=sys.stderr)
        return "", usage, r.model
    return "".join(b.text for b in r.content if b.type == "text"), usage, r.model


def chat(m, user, retries=4):
    """One chat request: (text, usage, model that wrote it)."""
    if m.get("provider") == "anthropic": return chat_anthropic(m, user)
    key = os.environ.get(m.get("key_env", ""), "")
    body = {"model": m["model"], "max_tokens": m.get("max_tokens", 8000),
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}], **m.get("extra", {})}
    if "temperature" in m: body["temperature"] = m["temperature"]
    body = json.dumps(body).encode()
    for attempt in range(retries + 1):
        req = urllib.request.Request(m["base_url"].rstrip("/") + "/chat/completions", data=body, method="POST",
                                     headers={"content-type": "application/json", **({"authorization": f"Bearer {key}"} if key else {})})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                d = json.load(r)
            text = (d.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            return text, d.get("usage", {}), d.get("model") or m["model"]
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
    """
    Which paragraph each model gets and what it is asked to do. Each paragraph goes to one model only. Paragraphs are
    dealt to the models in turn and every task is drawn from the paragraph's own id, so a smaller --per-model run (a
    pilot) is exactly the start of a larger one, and a later run continues it without giving a paragraph to two models.
    """
    pool = rows[:]
    random.Random(seed).shuffle(pool)
    kinds = list(mix)
    jobs = []
    for i, r in enumerate(pool[: per_model * len(models)]):
        rnd = random.Random(f"{seed}:{r['id']}")
        kind = rnd.choices(kinds, weights=[mix[k] for k in kinds])[0]
        inst = rnd.choice(TASKS[kind][1])
        lang = rnd.choice(LANGS) if kind == "translate" else None
        jobs.append({"model": models[i % len(models)], "row": r, "kind": kind, "instruction": inst.replace("{lang}", lang or ""), "lang": lang})
    return jobs


def run(job):
    m, r, kind = job["model"], job["row"], job["kind"]
    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    served = set()
    def ask(inst, para):
        text, u, by = chat(m, f"{inst}\n\n{para}")
        for k in usage: usage[k] += u.get(k, 0) or 0
        served.add(by)
        return text
    if kind == "translate":
        # Draft in another language, then the AI translates it back into English and polishes it, as such a writer would.
        foreign = ask(job["instruction"], r["text"])
        out = ask("Translate this paragraph into English and polish it for an international journal.", foreign) if foreign.strip() else ""
    else:
        out = ask(job["instruction"], r["text"])
    return clean(out), usage, "+".join(sorted(served))


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
            tin = calls * (len(j["row"]["text"].split()) * 1.4 + 80); tout = calls * j["model"].get("est_out", 330)
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
    per = {m["name"]: {"requests": 0, "kept": 0, "prompt_tokens": 0, "completion_tokens": 0} for m in models}
    with open(a.output, "a") as f, ThreadPoolExecutor(a.workers) as pool:
        futures = [(j, pool.submit(run, j)) for j in jobs]
        for n, (j, fut) in enumerate(futures, 1):
            try:
                text, usage, served_by = fut.result()
            except Exception as e:  # one failed request must not stop a long run
                failed += 1; print(f"{j['model']['name']} {j['row']['id']}: {type(e).__name__} {e}", file=sys.stderr); continue
            with lock:
                p = per[j["model"]["name"]]; p["requests"] += 1; p["kept"] += bool(text)
                for k in spent: spent[k] += usage[k]; p[k] += usage[k]
                if not text: failed += 1; continue
                r = j["row"]
                f.write(json.dumps({"label": "ai", "category": TASKS[j["kind"]][0], "kind": j["kind"], "model": j["model"]["name"],
                                    "served_by": served_by, "holdout": bool(j["model"].get("holdout")), "id": r["id"], "paper": r.get("paper"), "split": r.get("split"), "lang": j["lang"],
                                    "instruction": j["instruction"], "text": text}) + "\n")
                f.flush(); kept += 1
            if n % 50 == 0: print(f"{n}/{len(futures)} kept {kept} failed {failed} tokens {spent}", flush=True)
    print(f"done: kept {kept}, failed or unusable {failed}, tokens {spent}")
    # What this run actually cost, from the reported token counts and the listed prices.
    total = 0.0
    for m in models:
        p = per[m["name"]]
        if not p["requests"]: continue
        cost = (p["prompt_tokens"] * m.get("price_in", 0) + p["completion_tokens"] * m.get("price_out", 0)) / 1e6; total += cost
        print(f"  {m['name']:22s} {p['kept']}/{p['requests']} kept  {p['completion_tokens'] // max(1, p['requests'])} output tokens per request  ${cost:.3f}"
              f"  (${cost / max(1, p['kept']) * 1000:.2f} per 1,000 kept)")
    print(f"  total ${total:.2f}")


if __name__ == "__main__":
    main()
