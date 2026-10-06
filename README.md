# Veritome

Open-source pre-publication toolkit for researchers. Check a manuscript for plagiarism, AI-written text, weak
grammar and shaky citations *before* a journal or reviewer does.

| Tool | What it does |
| --- | --- |
| Plagiarism checker | Compares your text against open scholarly databases, optional web search and your own document library. Highlights matched passages with links to the source. |
| AI-text detector | Statistical signals plus an optional language-model opinion, shown per sentence with honest uncertainty. |
| Humaniser | Rewrites stiff or machine-sounding prose into natural writing while keeping citations, maths and numbers locked. |
| Paraphraser | Several rewrite modes (academic, simple, concise, expand) with the same protections. |
| Citation finder and checker | Finds papers for uncited claims, verifies every reference against Crossref, flags retractions and DOIs that point at the wrong paper, and cross-checks in-text citations against the reference list. |
| Grammar checker | Offline academic-style rules, spelling and optional LanguageTool, plus readability scores. |

> **Status: work in progress.** The tested engine for all six tools lives in `src/core`. The web app, Docker setup and
> full documentation are being added on top of it.

## Honest limits

No plagiarism or AI-detection tool is 100% accurate, including commercial ones. Veritome shows its evidence so you can
judge each flag yourself. See `docs/ACCURACY.md` once published.

## Development

```bash
npm run test:core     # engine tests (Node 22.18 or newer, no install needed)
npm run typecheck:core
```

## Licence

MIT. See [LICENSE](LICENSE).
