# Encyclopedic human writing: English Wikipedia articles as they stood before 2022, before AI writing tools. Detectors
# flag this register often (language models learned from it), so the models need it among their human examples.
#
#   python human-wiki.py data/human-wiki.jsonl [--articles 1200] [--exclude textsight-wiki.jsonl]
#   python human-wiki.py data/human-wiki.jsonl --dump train-00002-of-00041.parquet [--articles 1200]
#
# The API is rate-limited for unregistered clients (an hour gave about 200 articles), so --dump reads one file of the
# Wikimedia dump of 1 March 2022 instead (legacy-datasets/wikipedia on Hugging Face, config 20220301.en; needs
# pyarrow), which is from before ChatGPT and already plain text. Both write the same rows to the same file, and
# articles already in it are skipped.
#
# Random articles of some length; for each, the last revision before 2022, read as rendered prose: reference markers
# ("[1]"), tables, infoboxes, captions, lists and maths are left out. Paragraphs are joined into 150-380-word chunks,
# at most two per article, split by article (2 in 10 held out). Every row carries the title and revision for the
# CC BY-SA attribution (text from before June 2023 is CC BY-SA 3.0). Articles named in --exclude files (rows whose "attribution" quotes a title, as in the
# TextSight benchmark) are skipped. Standard library only.
import argparse, hashlib, json, os, random, re, sys, time, urllib.error, urllib.parse, urllib.request
from html.parser import HTMLParser

API = "https://en.wikipedia.org/w/api.php"
UA = {"user-agent": "Veritome detector training (https://github.com/Knsravan/Veritome)"}
BEFORE = "2021-12-31T23:59:59Z"


_last = [0.0]


def get(params, tries=8):
    """One API request, at most two a second; a 429 or 503 waits as long as Retry-After asks."""
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    for i in range(tries):
        time.sleep(max(0.0, _last[0] + 0.5 - time.time()))
        _last[0] = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if i == tries - 1 or e.code not in (429, 500, 502, 503, 504): raise
            wait = e.headers.get("retry-after")
            time.sleep(int(wait) + 1 if wait and wait.isdigit() else 5 * 2 ** i)
        except Exception:
            if i == tries - 1: raise
            time.sleep(5 * 2 ** i)


class Paragraphs(HTMLParser):
    """Top-level <p> text of a rendered article, without references, maths or anything inside tables and boxes."""
    SKIP = {"table", "sup", "style", "script", "math", "figure", "figcaption"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        # While skipping, the tag that started it and how deeply it is nested in itself.
        self.out, self.cur, self.in_p, self.skip_tag, self.skip = [], [], False, None, 0

    def handle_starttag(self, tag, attrs):
        if self.skip:
            if tag == self.skip_tag: self.skip += 1
            return
        cls = dict(attrs).get("class") or ""
        if tag in self.SKIP or "mwe-math" in cls or "noprint" in cls: self.skip_tag, self.skip = tag, 1
        elif tag == "p": self.in_p, self.cur = True, []

    def handle_endtag(self, tag):
        if self.skip:
            if tag == self.skip_tag: self.skip -= 1
        elif tag == "p" and self.in_p:
            self.in_p = False
            t = re.sub(r"\s+", " ", "".join(self.cur)).strip()
            if t: self.out.append(re.sub(r"\s+([,.;:)])", r"\1", t))

    def handle_data(self, data):
        if self.in_p and not self.skip: self.cur.append(data)


def random_titles(n, min_bytes=15000):
    out = set()
    while len(out) < n:
        d = get({"action": "query", "generator": "random", "grnnamespace": 0, "grnlimit": 50, "prop": "info"})
        for p in d.get("query", {}).get("pages", []):
            if p.get("length", 0) >= min_bytes and not re.search(r"^(List|Lists|Timeline|Index) of|\(disambiguation\)", p["title"]):
                out.add(p["title"])
    return sorted(out)[:n]


def revision_before(title):
    d = get({"action": "query", "prop": "revisions", "titles": title, "rvlimit": 1, "rvstart": BEFORE, "rvdir": "older", "rvprop": "ids|timestamp"})
    pages = d.get("query", {}).get("pages", [])
    revs = pages[0].get("revisions") if pages else None
    return (revs[0]["revid"], revs[0]["timestamp"]) if revs else (None, None)


def paragraphs(revid):
    d = get({"action": "parse", "oldid": revid, "prop": "text", "disablelimitreport": 1, "disableeditsection": 1})
    p = Paragraphs()
    p.feed(d.get("parse", {}).get("text", ""))
    # Prose only: no stubs of a line, no runs of figures.
    return [t for t in p.out if prose(t)]


def chunks(paras):
    """Paragraphs joined into 150-380-word chunks, at most two per article."""
    buf, out = [], []
    for t in paras:
        buf.append(t)
        w = sum(len(x.split()) for x in buf)
        if w >= 150:
            if w <= 380: out.append("\n\n".join(buf))
            buf = []
        if len(out) >= 2: break
    return out


def prose(t):
    return len(t.split()) >= 25 and sum(ch.isdigit() for ch in t) / max(1, len(t)) < 0.04


END = re.compile(r"^(see also|notes|references|external links|further reading|bibliography|sources|footnotes|citations)\s*$", re.I)


def from_dump(path, want, skip, out, split):
    """Articles from one parquet file of the 1 March 2022 dump, in a fixed random order; returns (chunks, articles)."""
    import pyarrow.parquet as pq  # only needed here
    t = pq.read_table(path, columns=["id", "title", "url", "text"])
    order = list(range(t.num_rows))
    random.Random(7).shuffle(order)
    total = kept = 0
    for i in order:
        if kept >= want: break
        title = t.column("title")[i].as_py()
        if title in skip or re.search(r"^(List|Lists|Timeline|Index) of|\(disambiguation\)", title): continue
        text = t.column("text")[i].as_py()
        if len(text) < 8000: continue  # long articles, as with the API
        paras = []
        for line in text.split("\n"):
            if END.match(line.strip()): break
            if prose(line.strip()): paras.append(re.sub(r"\s+", " ", line).strip())
        texts = chunks(paras)
        if not texts: continue
        aid = t.column("id")[i].as_py()
        for k, c in enumerate(texts):
            out.write(json.dumps({"id": f"wiki22-{aid}-{k}", "paper": f"wiki:{title}", "title": title, "url": t.column("url")[i].as_py(),
                                  "licence": "CC BY-SA 3.0", "attribution": f"Wikipedia contributors, '{title}', as in the Wikimedia dump of 1 March 2022",
                                  "source": "wiki-20220301", "split": split(f"wiki:{title}"), "text": c}) + "\n")
        total += len(texts); kept += 1
    return total, kept


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("output")
    ap.add_argument("--articles", type=int, default=1200, help="articles to keep (with at least one chunk)")
    ap.add_argument("--exclude", action="append", default=[])
    ap.add_argument("--dump", help="a parquet file of the 1 March 2022 Wikimedia dump to read instead of the API")
    a = ap.parse_args()
    exclude = set()
    for f in a.exclude:
        for l in open(f):
            m = re.search(r"'([^']+)'", json.loads(l).get("attribution", ""))
            if m: exclude.add(m.group(1))
    # Rows are written as each article is done, so an interrupted run keeps its work and a rerun adds to it.
    done = set()
    if os.path.exists(a.output):
        done = {json.loads(l)["title"] for l in open(a.output) if l.strip()}
    want = a.articles - len(done)
    split = lambda paper: "test" if int(hashlib.md5(paper.encode()).hexdigest(), 16) % 10 < 2 else "train"
    out = open(a.output, "a")
    if a.dump:
        total, kept = from_dump(a.dump, want, done | exclude, out, split)
        out.close()
        print(f"{total} chunks added from {kept} articles of the dump ({len(done)} articles were already done)")
        return
    total = kept = n = 0
    tried, pool = set(done) | exclude, []
    # About a third of long random articles have enough running prose, so titles are drawn until enough are kept.
    while kept < want:
        if not pool:
            pool = [t for t in random_titles(100) if t not in tried]
            continue
        title = pool.pop(); tried.add(title); n += 1
        try:
            revid, ts = revision_before(title)
            if not revid: continue  # created in 2022 or later
            paras = paragraphs(revid)
        except Exception as e:
            print(f"{title}: {type(e).__name__}", file=sys.stderr); continue
        rows = [{"id": f"wiki-{revid}-{k}", "paper": f"wiki:{title}", "title": title, "revision": revid, "timestamp": ts,
                 "url": f"https://en.wikipedia.org/w/index.php?oldid={revid}", "licence": "CC BY-SA 3.0",
                 "attribution": f"Wikipedia contributors, '{title}', revision {revid} ({ts[:10]})",
                 "source": "wiki-pre2022", "split": split(f"wiki:{title}"), "text": c} for k, c in enumerate(chunks(paras))]
        for r in rows: out.write(json.dumps(r) + "\n")
        out.flush()
        total += len(rows); kept += bool(rows)
        if n % 100 == 0: print(f"{n} articles read, {kept}/{want} kept, {total} chunks", flush=True)
    out.close()
    print(f"{total} chunks added from {kept} articles ({n} read; {len(done)} were already done)")


if __name__ == "__main__":
    main()
