---
phase: 1
title: "Repo and Data Contract"
status: completed
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Repo and Data Contract

## Overview

Create the public repo `hong4rc/book`, its skeleton, and the single normalized
book record schema every later phase reads and writes. Nothing downstream can be
built until the record shape is fixed.

## Requirements

- Functional: public repo under `hong4rc`; GitHub Pages enabled; a JSON Schema
  for the book record; a validator runnable locally and in CI.
- Non-functional: repo clone under 50MB forever (enforced by `.gitignore`
  refusing EPUB/PDF/MOBI binaries); Node 20+, zero runtime dependencies for the
  published site.

## Architecture

Layout:

```
book/
  data/
    books.ndjson          # one normalized record per line, sorted by id
    facets.json           # derived taxonomy (Phase 3)
    shards/NN.json        # detail records, lazy-loaded by the site
    custom/               # operator-supplied CSV drop-in
  schema/
    book.schema.json      # JSON Schema, the contract
  scripts/
    adapters/             # one module per source (Phase 2)
    build-index.mjs       # Phase 4
    validate.mjs          # schema check over books.ndjson
  docs/                   # GitHub Pages root
  .github/workflows/
```

`books.ndjson` is newline-delimited JSON, **sorted by `id`**, so a refresh
produces a minimal, reviewable git diff instead of a whole-file rewrite.

Record contract:

| Field | Type | Notes |
|---|---|---|
| `id` | string | `"<source>:<pageTitle>"`, stable primary key |
| `title` | string | Display title |
| `author` | string \| null | Null when Wikisource has no author link |
| `language` | string | BCP-47, `"vi"` for this corpus |
| `source` | string | `"vi.wikisource"`, `"custom"`, ... |
| `sourceUrl` | string | Canonical human-readable page |
| `downloads` | array | `{format, url}`; url built, not stored as a file |
| `categories` | string[] | Cleaned taxonomy (Phase 3) |
| `rawCategories` | string[] | Unfiltered, kept for re-derivation |
| `chapters` | integer | Count of subpages; 0 for single-page works |
| `quality` | string \| null | Wikisource proofread level (`100%`, `75%`, ...) |
| `license` | string | `"PD"` or `"CC-BY-SA-4.0"` |
| `updated` | string | ISO date of last ingest |

`rawCategories` is retained deliberately: Phase 3's taxonomy is a lossy
derivation, and keeping the raw strings means it can be re-derived without
re-hitting the API.

## Related Code Files

- Create: `schema/book.schema.json`
- Create: `scripts/validate.mjs`
- Create: `.gitignore`, `README.md`, `LICENSE`
- Create: `package.json` (Node 20+, `type: module`)

## Implementation Steps

1. `gh repo create hong4rc/book --public --description "..."`, clone locally.
2. Write `schema/book.schema.json` encoding the table above; `required` covers
   `id`, `title`, `language`, `source`, `sourceUrl`, `downloads`, `license`.
3. Write `scripts/validate.mjs`: stream `books.ndjson`, validate each line,
   assert `id` uniqueness and ascending sort, exit non-zero on any failure.
4. `.gitignore` must list `*.epub`, `*.mobi`, `*.pdf` — a guardrail against the
   30GB mistake, not a preference.
5. `README.md`: what the project is, provenance per source, licence per source,
   and an explicit note that no book binaries are stored.
6. Repo `LICENSE`: code MIT. State separately that catalogued *content* carries
   its own upstream licence and is not relicensed here.
7. Commit a 3-record `books.ndjson` fixture by hand; confirm the validator
   passes it and fails a deliberately corrupted copy.

## Success Criteria

- [ ] `github.com/hong4rc/book` exists, is public, Pages enabled
- [ ] `schema/book.schema.json` validates the fixture
- [ ] `node scripts/validate.mjs` exits 0 on the fixture, non-zero when corrupted
- [ ] `.gitignore` blocks ebook binaries
- [ ] `README.md` states provenance and per-source licence

## Risk Assessment

- **Schema churn later.** Adding a field mid-project rewrites every record.
  Mitigation: `rawCategories` plus an unvalidated `extra` object absorb
  source-specific data without a schema bump. Signal: a Phase 2 or 3 change
  needs a new required field. Response: bump a `schemaVersion` constant and
  re-run ingest, which is cheap because ingest is a pure transform.
- **Repo made public with wrong content.** Mitigation: repo starts with a
  fixture only; real ingest lands via PR in Phase 2.
