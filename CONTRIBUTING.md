# Contributing

## Shape of the project

Four pure, file-to-file stages. Each one re-runs on its own, and every output is
committed so the site works from a plain clone.

```
scripts/ingest.mjs        vi.wikisource API  -> data/books.ndjson
scripts/derive-facets.mjs data/books.ndjson  -> data/facets.json + categories
scripts/build-index.mjs   data/books.ndjson  -> site/data/*
scripts/validate.mjs      gate on data/books.ndjson
```

`npm run refresh` runs all four in order.

## Data changes arrive as pull requests

The weekly Action opens a PR; it never pushes to `main`. This is deliberate.

A partially failed ingest looks identical to a legitimate mass deletion, so
catalogue changes are reviewed as a diff by a person. Two guardrails support
that: `data/books.ndjson` is sorted by `id` so diffs stay small and readable,
and `ingest.mjs` refuses to write at all if the record count falls more than 5%
below the previous run.

When reviewing a refresh PR, check the record count first.

## Before you push

```bash
npm test           # folding fixtures + schema/uniqueness/sort validation
npm run build      # site/data must be regenerated when data changes
```

CI fails if `site/data` is stale, because the site is served straight from the
repository.

## Rules that are not negotiable

**Never commit ebook binaries.** `.gitignore` blocks them. Each Wikisource EPUB
is ~4.35MB, mostly repeated embedded fonts; the full corpus would be ~30GB
against a GitHub limit of roughly 1–5GB. Downloads are generated on demand.

**Never scrape.** Use the MediaWiki API. Requests go through
`scripts/lib/http.mjs`, which sets a descriptive User-Agent, paces to one
request per second, and backs off on 429/503 — this API does throttle, and that
was found the hard way. Do not call `fetch` directly from an adapter.

**Never guess an author.** A null author is correct and common; a wrong one is
worse than none. Only a real link into the `Tác gia` namespace counts.

## Adding a source

Add one file to `scripts/adapters/` exporting `id` and `fetchRecords`, then
register it in `scripts/ingest.mjs`. Records must satisfy
`schema/book.schema.json`. See `custom-csv.mjs` for the minimal shape.

## Editing the category taxonomy

`config/taxonomy.json` is data, not code — edit it and re-run
`npm run facets`. Grouping Vietnamese categories is a judgement call, so it is
meant to be tuned. `plans/reports/category-coverage.md` is regenerated each run
and lists what was rejected and what stayed unmapped; use it to find the next
worthwhile grouping term.

Raw upstream categories are kept on every record, so the taxonomy can always be
re-derived offline without touching the API.
