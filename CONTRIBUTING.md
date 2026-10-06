# Contributing to Veritome

Thanks for helping. Veritome exists to give researchers honest, inspectable checks, so the bar for a change is:
does it make results more accurate, or make their limits clearer?

## Most wanted

1. **Labelled evaluation data** for the AI-pattern check: modern human academic writing (especially by non-native
   English writers) and recent model output, under a licence that allows redistribution. Run
   `node scripts/evaluate-detector.ts your.jsonl` and share the numbers, even (especially) when they are bad.
2. **Reference-parser cases** that fail: paste the raw entry and what it should parse to in an issue.
3. **New open sources** for plagiarism or citation checks, as a `SourceProvider` or client in `src/core`.
4. **Translations** of the stock-phrase lexicon and grammar rules for other languages.

## Ground rules

- Never log, store or send user text anywhere the user has not agreed to. New outside calls must go through the
  consent flow and be listed on the Limits page.
- Do not overclaim. Any new score needs a disclaimer, an uncertainty treatment or both, and an entry in
  `docs/ACCURACY.md`. Words like "proves" or "guarantees" do not belong in the interface.
- `src/core` stays dependency-free and offline-testable: inject `Http` or `LlmClient`, never call `fetch` directly.
- Write tests with the code. Engine tests use `node:test`; UI and route tests use Vitest; flows that cross the
  browser go in `e2e/`.
- Keep the interface accessible: keyboard reachable, visible focus, labels on every control, colour never the only
  signal. The e2e suite runs axe; it must stay green.

## Setup

```bash
npm install
npm run dev
npm test && npm run typecheck
npm run build && npm run e2e     # set PLAYWRIGHT_CHROMIUM_PATH to use an installed Chromium
```

## Pull requests

- One focused change per pull request, with a short description of what changed and how you tested it.
- Commit messages say what changed and why, in the imperative ("Add DataCite fallback for DOI lookups").
- CI must pass: typecheck, all tests, production build, browser smoke test and Docker build.

By contributing you agree that your work is released under the MIT licence.
