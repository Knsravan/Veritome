# Human research writing by authors outside the English-speaking countries: open-access (CC BY) papers published
# before AI writing tools, from Europe PMC. Detectors flag this writing more often than native-speaker prose, so the
# models need it among their human examples (and the thresholds need it among the human texts they are set on).
#
#   python human-pmc.py data/human-esl.jsonl [--per-country 120] [--exclude textsight-pmc.jsonl]
#
# Writes the same rows as human-chunks.py ({"id", "paper", "split", "text", ...}): body paragraphs joined into
# 150-380-word chunks, at most two per paper, split by paper (2 in 10 papers held out). Citations stay as a reader
# sees them ("[12]", "(Silva et al., 2019)"). Papers listed in --exclude files (rows with "pmc_id" or "pmcid"), such
# as the TextSight benchmark, are skipped so they stay a clean test set. Standard library only.
import argparse, hashlib, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

API = "https://www.ebi.ac.uk/europepmc/webservices/rest"
COUNTRIES = ["Brazil", "China", "Japan", "Korea", "Indonesia", "Thailand", "Iran", "Turkey", "Italy", "Spain", "Germany",
             "France", "Poland", "Egypt", "Nigeria", "Mexico", "Pakistan", "India", "Vietnam", "Saudi Arabia"]
ANGLO = re.compile(r"\b(USA|United States|U\.S\.A|United Kingdom|UK|England|Scotland|Wales|Ireland|Canada|Australia|New Zealand)\b")
UA = {"user-agent": "Veritome detector training (https://github.com/Knsravan/Veritome)"}


def get(url, as_json=True, tries=8):
    """One request; a 429 or 503 waits as long as Retry-After asks."""
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r) if as_json else r.read()
        except urllib.error.HTTPError as e:
            if i == tries - 1 or e.code not in (429, 500, 502, 503, 504): raise
            wait = e.headers.get("retry-after")
            time.sleep(int(wait) + 1 if wait and wait.isdigit() else 5 * 2 ** i)
        except Exception:
            if i == tries - 1: raise
            time.sleep(5 * 2 ** i)


def first_affiliation(r):
    a = (r.get("authorList", {}).get("author") or [{}])[0]
    d = (a.get("authorAffiliationDetailsList", {}).get("authorAffiliation") or [{}])[0]
    return d.get("affiliation") or a.get("affiliation") or ""


def search(country, want, years="2012 TO 2021"):
    q = f'OPEN_ACCESS:y AND LICENSE:"cc by" AND SRC:PMC AND LANG:eng AND PUB_YEAR:[{years}] AND AFF:"{country}"'
    cursor, out = "*", []
    while len(out) < want:
        d = get(f"{API}/search?" + urllib.parse.urlencode({"query": q, "resultType": "core", "format": "json", "pageSize": 100, "cursorMark": cursor}))
        rows = d.get("resultList", {}).get("result", [])
        if not rows: break
        for r in rows:
            # The first author's own institution, so the main writer is most likely not a native speaker.
            aff = first_affiliation(r)
            if r.get("pmcid") and re.search(rf"\b{re.escape(country)}\b", aff, re.I) and not ANGLO.search(aff):
                out.append(r)
        if d.get("nextCursorMark") in (None, cursor): break
        cursor = d["nextCursorMark"]
    return out[:want]


def text_of(el):
    """A paragraph's text as a reader sees it: citations kept, tables, figures and formulas left out."""
    parts = []
    def walk(e):
        if e.tag in ("table-wrap", "fig", "disp-formula", "inline-formula", "table", "graphic"):
            if e.tail: parts.append(e.tail)
            return
        if e.text: parts.append(e.text)
        for c in e: walk(c)
        if e.tail and e is not el: parts.append(e.tail)
    walk(el)
    t = re.sub(r"\s+", " ", "".join(parts)).strip()
    return re.sub(r"\s+([,.;:)])", r"\1", t)


def paragraphs(pmcid):
    xml = get(f"{API}/{pmcid}/fullTextXML", as_json=False)
    body = ET.fromstring(xml).find(".//body")
    if body is None: return []
    out = []
    for sec in body.iter("sec"):
        title = (sec.findtext("title") or "").lower()
        if re.search(r"method|material|statistic|data avail|funding|acknowledg|conflict|abbreviation|supplement", title): continue
        for p in sec.findall("p"):
            t = text_of(p)
            if len(t.split()) >= 25 and sum(ch.isdigit() for ch in t) / max(1, len(t)) < 0.04: out.append(t)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("output")
    ap.add_argument("--per-country", type=int, default=120)
    ap.add_argument("--exclude", action="append", default=[])
    a = ap.parse_args()
    exclude = set()
    for f in a.exclude:
        for l in open(f):
            d = json.loads(l); exclude.add(d.get("pmc_id") or d.get("pmcid"))
    # Rows are written as each paper is done, so an interrupted run keeps its work and a rerun adds to it.
    have = {}
    if os.path.exists(a.output):
        for l in open(a.output):
            if l.strip():
                d = json.loads(l); have.setdefault(d["country"], set()).add(d["paper"])
    seen = set().union(*have.values()) if have else set()
    split = lambda paper: "test" if int(hashlib.md5(paper.encode()).hexdigest(), 16) % 10 < 2 else "train"
    out = open(a.output, "a")
    total = 0
    for country in COUNTRIES:
        kept = len(have.get(country, ()))
        if kept >= a.per_country: continue
        papers = [p for p in search(country, a.per_country * 8) if p["pmcid"] not in exclude and p["pmcid"] not in seen]
        for p in papers:
            if kept >= a.per_country: break
            seen.add(p["pmcid"])
            try:
                paras = paragraphs(p["pmcid"])
            except Exception as e:
                print(f"{p['pmcid']}: {type(e).__name__}", file=sys.stderr); continue
            buf, k, rows = [], 0, []
            for t in paras:
                buf.append(t)
                w = sum(len(x.split()) for x in buf)
                if w >= 150:
                    if w <= 380:
                        # CC BY asks for credit, so every row carries its paper's citation.
                        rows.append({"id": f"{p['pmcid']}-{k}", "paper": p["pmcid"], "country": country, "year": p.get("pubYear"),
                                     "title": p.get("title"), "authors": p.get("authorString"), "journal": p.get("journalInfo", {}).get("journal", {}).get("title"),
                                     "doi": p.get("doi"), "licence": "CC BY", "source": "pmc-esl", "split": split(p["pmcid"]), "text": "\n\n".join(buf)})
                        k += 1
                    buf = []
                if k >= 2: break
            for r in rows: out.write(json.dumps(r) + "\n")
            out.flush()
            total += len(rows)
            kept += k > 0
            time.sleep(0.2)  # Europe PMC asks for moderate request rates
        print(f"{country}: {kept} papers", flush=True)
    out.close()
    print(f"{total} chunks added")


if __name__ == "__main__":
    main()
