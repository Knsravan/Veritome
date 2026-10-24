# Encyclopedic human writing: English Wikipedia articles as they stood before 2022, before AI writing tools. Detectors
# flag this register often (language models learned from it), so the models need it among their human examples.
#
#   python human-wiki.py data/human-wiki.jsonl [--articles 1500] [--exclude textsight-wiki.jsonl]
#
# Random articles of some length; for each, the last revision before 2022, read as rendered prose: reference markers
# ("[1]"), tables, infoboxes, captions, lists and maths are left out. Paragraphs are joined into 150-380-word chunks,
# at most two per article, split by article (2 in 10 held out). Every row carries the title and revision for the
# CC BY-SA attribution. Articles named in --exclude files (rows whose "attribution" quotes a title, as in the
# TextSight benchmark) are skipped. Standard library only.
import argparse, hashlib, html, json, re, sys, time, urllib.parse, urllib.request
from html.parser import HTMLParser

API = "https://en.wikipedia.org/w/api.php"
UA = {"user-agent": "Veritome detector training (https://github.com/Knsravan/Veritome)"}
BEFORE = "2021-12-31T23:59:59Z"


def get(params, tries=4):
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except Exception:
            if i == tries - 1: raise
            time.sleep(2 ** i)


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
        time.sleep(0.1)
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
    return [t for t in p.out if len(t.split()) >= 25 and sum(ch.isdigit() for ch in t) / max(1, len(t)) < 0.04]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("output")
    ap.add_argument("--articles", type=int, default=1500)
    ap.add_argument("--exclude", action="append", default=[])
    a = ap.parse_args()
    exclude = set()
    for f in a.exclude:
        for l in open(f):
            m = re.search(r"'([^']+)'", json.loads(l).get("attribution", ""))
            if m: exclude.add(m.group(1))
    titles = [t for t in random_titles(a.articles + len(exclude)) if t not in exclude][: a.articles]
    rows = []
    for n, title in enumerate(titles, 1):
        try:
            revid, ts = revision_before(title)
            if not revid: continue  # created in 2022 or later
            paras = paragraphs(revid)
        except Exception as e:
            print(f"{title}: {type(e).__name__}", file=sys.stderr); continue
        buf, k = [], 0
        for t in paras:
            buf.append(t)
            w = sum(len(x.split()) for x in buf)
            if w >= 150:
                if w <= 380:
                    rows.append({"id": f"wiki-{revid}-{k}", "paper": f"wiki:{title}", "title": title, "revision": revid, "timestamp": ts,
                                 "url": f"https://en.wikipedia.org/w/index.php?oldid={revid}", "licence": "CC BY-SA 4.0",
                                 "attribution": f"Wikipedia contributors, '{title}', revision {revid} ({ts[:10]})",
                                 "source": "wiki-pre2022", "text": "\n\n".join(buf)})
                    k += 1
                buf = []
            if k >= 2: break
        time.sleep(0.1)
        if n % 100 == 0: print(f"{n}/{len(titles)} articles, {len(rows)} chunks", flush=True)
    for r in rows: r["split"] = "test" if int(hashlib.md5(r["paper"].encode()).hexdigest(), 16) % 10 < 2 else "train"
    with open(a.output, "w") as f:
        for r in rows: f.write(json.dumps(r) + "\n")
    print(len(rows), "chunks,", sum(r["split"] == "test" for r in rows), "held out")


if __name__ == "__main__":
    main()
