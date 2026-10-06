# Veritome

Open-source pre-publication checks for researchers. Look for overlap with published work, AI-style writing patterns,
shaky references and grammar slips in your manuscript *before* a journal or reviewer does. Every flag comes with its
evidence and an honest note on how sure it is.

| Tool | What it does | What it cannot do |
| --- | --- | --- |
| **Plagiarism** | Finds copied and reworded passages using exact-phrase search of arXiv, Europe PMC full text, Wikipedia, CORE full text (free key), OpenAlex, Crossref and Semantic Scholar, optional Brave or Serper web search, and your own documents. Each match links to its source. | Cannot see paywalled full texts, theses or student-paper databases. Heavy rewriting and translation can slip through. A low score is not proof of originality. |
| **AI writing patterns** | A classifier trained on about 90,000 labelled human and machine texts, calibrated so roughly 1 in 100 human texts or fewer is flagged. Undoes evasion tricks (lookalike letters, invisible characters), scores long documents section by section, and shows the wording behind the score. | Cannot prove who wrote a text. Catches about half of machine text in testing; paraphrased text and new models are often "inconclusive". |
| **Humaniser** | Revises stiff, formulaic prose while citations, maths, URLs and numbers stay locked. Shows the pattern score before and after. | Does not make text human-written. Disclose AI assistance where your publisher asks. |
| **Paraphraser** | Academic, simple, concise or expanded rewrites with the same protections and checks. | Meaning can drift in ways a number check cannot catch. Read every rewrite. |
| **Citations** | Verifies each reference against Crossref, OpenAlex, DataCite and arXiv; flags retractions, wrong DOIs and mismatched details; cross-checks in-text citations; finds papers for uncited claims; formats in six styles and BibTeX. | "Not found" is not "fabricated": books and reports are often missing from these databases. Suggested papers may not support your claim. |
| **Grammar** | High-precision academic-style rules, common misspellings and readability scores, plus LanguageTool when connected. Fixes apply in place. | The built-in rules are not a full grammar parser; readability formulas are rough guides. |

The **Full report** runs all six on a whole paper (paste it, or upload .docx, .pdf, .tex, .md or .txt) and exports
Markdown or JSON.

## Honest limits

No plagiarism checker or AI detector is 100% accurate, commercial ones included. Veritome is built to show its
evidence, give every score a range, and say what each check cannot see. Measured on text it never saw in
training, the AI-pattern check wrongly flagged 0.2% of 1,387 human passages and caught 46% of 2,261 machine-written
ones (86% for Llama-3, about half for GPT-4o). In a small live plagiarism test, every copied sentence taken from two
well-known papers. Read [docs/ACCURACY.md](docs/ACCURACY.md) for the method, numbers and caveats before relying on
any result.

## Privacy

- Text and files are processed in memory and never stored or logged by Veritome.
- Checks that query outside services (plagiarism search, reference lookups, source suggestions) ask the user first
  and name the services. The server refuses these requests without that confirmation.
- Rewriting sends text to the language model the operator configures, which can be a local Ollama model.
- For confidential manuscripts, self-host with Docker and a local model.

## Put it online with Vercel (free)

1. Sign in at [vercel.com](https://vercel.com) with GitHub, choose **Add New → Project**, pick this repository and
   click **Deploy**. No settings are needed for a first run.
2. Optional, under **Settings → Environment Variables** (then **Redeploy**): `OPENALEX_API_KEY`, `CORE_API_KEY` and
   `CONTACT_EMAIL` for better searches, and `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` for real rewriting.
3. Optional: attach your own domain under **Settings → Domains**.

On Vercel, uploads are limited to about 4 MB (Vercel's request limit) and each check can run for up to 5 minutes.
The shared document library (`LIBRARY_DIR`) is not available there; users can still attach their own documents.
Vercel's free Hobby plan is for non-commercial use.

## Quick start with Docker

```bash
git clone https://github.com/Knsravan/Veritome.git && cd Veritome
cp .env.example .env          # optional: add CONTACT_EMAIL, LLM settings, API keys
docker compose up -d          # http://localhost:3000
```

Add the optional services with profiles:

```bash
# Local LanguageTool for grammar (set LANGUAGETOOL_URL=http://languagetool:8010 in .env)
docker compose --profile languagetool up -d

# Local language model with Ollama (set LLM_BASE_URL=http://ollama:11434/v1 and LLM_MODEL=llama3.1:8b in .env)
docker compose --profile ollama up -d
docker compose exec ollama ollama pull llama3.1:8b
```

Put earlier papers in `./library` (.txt, .md, .tex, .docx or .pdf) and every plagiarism check compares against
them too. The folder is mounted read-only.

## Configuration

All settings are environment variables and all are optional; see [.env.example](.env.example) for the full list.

| Variable | Purpose |
| --- | --- |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | Any OpenAI-compatible endpoint for the paraphraser, humaniser and optional detector opinion. Without one, rewriting falls back to light rule-based edits and says so. |
| `ALLOW_CLIENT_LLM`, `ALLOW_PRIVATE_LLM` | Let visitors bring their own model from Settings (off by default). Their URLs pass an SSRF guard; cloud metadata addresses are always refused. |
| `LANGUAGETOOL_URL` | A LanguageTool server for broader grammar and spelling checks. |
| `CONTACT_EMAIL` | Sent to Crossref and OpenAlex for their polite pools. Recommended. |
| `OPENALEX_API_KEY` | Free and effectively required: without it OpenAlex shares a tiny daily budget across your server's IP address. |
| `CORE_API_KEY` | Free: lets plagiarism checks search the full text of 30+ million open-access papers. |
| `SEMANTIC_SCHOLAR_API_KEY` | Higher rate limits and full-text snippet search for plagiarism checks. |
| `BRAVE_API_KEY`, `SERPER_API_KEY` | Optional web search for plagiarism checks. |
| `LIBRARY_DIR` | Folder of documents every plagiarism check also compares against. |
| `RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY` | Abuse protection. Only trust `X-Forwarded-For` behind a proxy you control. |

Check that every configured service is reachable with `node --env-file=.env scripts/smoke-sources.ts`.

## Development

Requires Node.js 22.18 or newer (the engine tests run TypeScript directly with `node --test`).

```bash
npm install
npm run dev               # http://localhost:3000
npm test                  # engine (node --test), server and web (Vitest) tests
npm run typecheck
npm run build
npm run e2e               # Playwright smoke test with axe accessibility checks (after build)
node scripts/evaluate-detector.ts data.jsonl   # measure the AI-pattern check on labelled text
```

The checking engine in `src/core` has no dependencies and runs in Node or the browser. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit and [CONTRIBUTING.md](CONTRIBUTING.md) for
how to help. Labelled evaluation data for the AI-pattern check is the most valuable contribution.

## Licence

MIT. See [LICENSE](LICENSE).
