# Architecture

Veritome has three layers. Each depends only on the one below it.

```
 Browser (src/app pages, src/components, src/lib)
   │  fetch JSON / multipart
   ▼
 Server (src/app/api routes → src/server)
   │  config from env, wires real HTTP clients, rate limits, consent checks
   ▼
 Engine (src/core) – dependency-free TypeScript, every outside call injected
```

## Engine: `src/core`

No npm dependencies. Every network call goes through an injected `Http` or `LlmClient`, so the whole engine is
tested offline with mock fetches (`tests/core`, run with `node --test`).

| Folder | Contents |
| --- | --- |
| `text/` | Sentence and paragraph splitting with exact offsets, tokens, statistics (MATTR, CV), title similarity, reference-list detection, word diff, LaTeX-to-text and PDF line repair. `protect.ts` swaps citations, maths, URLs, DOIs and cross-references for `{{Pn}}` placeholders and restores them; `checkNumbersPreserved` compares numbers as multisets. |
| `infra/` | HTTP client with timeouts, retries and redacted errors; `netguard.ts` SSRF guard (blocks metadata ranges always, private ranges unless allowed, credentials in URLs); fixed-window rate limiter. |
| `llm/` | OpenAI-compatible chat client and the rules for when a browser-supplied model may be used. |
| `grammar/` | Offline rules and lexicons, readability metrics, LanguageTool client and merge logic. |
| `citations/` | Reference parser, verifier (DOI then title lookup, discrepancy and retraction flags), in-text cross-check, claim finder and paper suggestions, formatters (APA, MLA, IEEE, Chicago, Harvard, Vancouver, BibTeX, RIS), and clients for Crossref, OpenAlex, Semantic Scholar, arXiv and DataCite. |
| `plagiarism/` | Passage selection, search providers (scholarly databases, Brave, Serper, Semantic Scholar snippets), seeded n-gram matching that bridges small edits, self-repetition and the `checkPlagiarism` pipeline. |
| `detector/` | Stock-phrase and connective lexicons, the four statistical signals, score combination, uncertainty bands, conservative verdicts, per-sentence cues and the optional LLM judge. |
| `rewrite/` | Paraphraser and humaniser: protect → chunk by paragraph → LLM → restore and validate (placeholders, numbers, length) → retry with feedback → keep the original if every attempt fails. Rule-based fallback without a model. Before/after detector scores and the humaniser disclosure. |
| `report/` | `buildPaperReport` runs all six tools with injected dependencies; a failing tool becomes an error section, not a failed report. |

### Offsets

Every finding carries character offsets into the text the user submitted (or its body, which is always a prefix
because the reference list is split off the end). Masking replaces protected spans with a control character of
the same length, so offsets survive masking. The interface relies on this to draw marks on the original text.

### Honesty by construction

- Every result type carries its own `disclaimer` or `warnings`, so no caller can show a score without its limits.
- The detector exposes `band` and only returns a verdict when the whole band is on one side.
- The plagiarism report lists which providers were queried, how many queries failed and what each can see.
- Reference checks distinguish "not found" from "unchecked" (a lookup failed).

## Server: `src/server` and `src/app/api`

| File | Role |
| --- | --- |
| `config.ts` | Reads environment variables; `PublicStatus` is the only view of it the browser gets (no keys or URLs). |
| `deps.ts` | Builds the HTTP client (with a polite User-Agent and contact address), scholarly clients, providers, LanguageTool options and the LLM client. |
| `api.ts` | `route()` wrapper: per-route rate limits, JSON size limits, input validation, error mapping and `no-store` replies. Request bodies are never logged. `requireConsent()` refuses outside lookups unless the browser confirms the user agreed. |
| `extract.ts` | In-memory text extraction: .docx with mammoth, .pdf with unpdf, .tex, .md and .txt; magic-byte detection, size limits, clear errors for scanned or damaged files. |
| `library.ts` | Loads the operator's read-only document library from `LIBRARY_DIR`, cached for five minutes. |

Routes: `GET /api/status`, and `POST` to `/api/extract`, `/api/grammar`, `/api/detect`, `/api/rewrite`,
`/api/plagiarism`, `/api/citations/verify`, `/api/citations/find` and `/api/report`. Each is a thin adapter from
JSON to an engine function.

## Browser: `src/app`, `src/components`, `src/lib`

- One page per tool plus the full report, settings and limits pages.
- `TextSource` handles paste and upload; `AnnotatedText` draws findings as keyboard-focusable marks linked to margin
  notes; `BandBar` shows a score with its range; `DiffView` shows rewrites.
- `ConsentProvider` asks before any request that reaches outside services and can remember the answer on the
  device. `SettingsProvider` keeps preferences in `localStorage` and fetches `/api/status`.
- Fonts are self-hosted with `@fontsource-variable` (Source Serif 4 for manuscript text, Atkinson Hyperlegible Next
  for the interface). Colours are CSS tokens with a dark theme; Playwright runs axe on every page in both themes.

## Tests

| Command | What |
| --- | --- |
| `npm run test:core` | Engine, offline with mocked HTTP (`node --test`) |
| `npm run test:server` | Extraction and library with real fixture files (`node --conditions=react-server --test`) |
| `npm run test:web` | Route handlers and components (Vitest, jsdom) |
| `npm run e2e` | Production build in Chromium: every tool on the sample text, consent flow, downloads, axe |
| `scripts/smoke-sources.ts` | Live check of each configured outside service |
| `scripts/evaluate-detector.ts` | Detector metrics on labelled JSONL |
