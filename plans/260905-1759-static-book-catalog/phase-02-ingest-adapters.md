---
phase: 2
title: "Ingest Adapters"
status: pending
priority: P1
effort: "6h"
dependencies: [1]
---

# Phase 2: Ingest Adapters

## Overview

Fetch every root work from Vietnamese Wikisource through its API and emit
schema-valid records into `data/books.ndjson`. No HTML scraping anywhere.

## Requirements

- Functional: enumerate all ns=0 non-redirect pages; separate root works from
  chapter subpages; attach author, categories, and proofread quality; build the
  `ws-export` EPUB URL per work.
- Non-functional: honour the Wikimedia User-Agent policy; cap at 1 request per
  second; retry 429/503 with exponential backoff; the whole run must be
  resumable and idempotent.

## Architecture

One module per source behind a uniform interface:

```js
// scripts/adapters/<name>.mjs
export const id = 'vi.wikisource'
export async function *fetchRecords({ log, http }) { /* yields book records */ }
```

`scripts/ingest.mjs` loads adapters, merges their output by `id`, sorts, and
writes `books.ndjson`. Adding a source means adding one file.

**Rate limiting is a hard requirement, not a nicety.** Probing hit
`HTTP 429 Too Many Requests` with a generic UA and unpaced requests. The proven
fix, already validated during planning:

```js
const UA = 'book-catalog/1.0 (https://github.com/hong4rc/book; <contact>)'
// 1 req/s, retry 429/503 with 2s, 4s, 6s backoff
```

**Root vs chapter.** Measured over a 4,112-title sample: 36.1% root works,
63.9% chapter subpages. A title containing `/` is a subpage of its parent. The
count of a work's subpages becomes `chapters`. Projection over 19,104 articles
gives roughly 6,900 root works — but that sample was alphabetically biased, so
this phase records the **real** number and the plan's estimate is corrected from
the run, not defended.

**Two-pass design.** Pass 1 enumerates titles cheaply (`list=allpages`, 500 per
request). Pass 2 hydrates metadata in batches of 50 (`prop=categories|links`,
`titles=` accepts 50 per call), which keeps request count near
`roots/50 + roots/500` rather than one call per book.

**Download URL is built, never stored:**

```
https://ws-export.wmcloud.org/?lang=vi&format=epub&page=<urlencoded title>
```

Verified to return `application/epub+zip`. `epub` is primary; `pdf` and
`mobi` are offered by the same service and added as alternate entries.

## Related Code Files

- Create: `scripts/adapters/vi-wikisource.mjs`
- Create: `scripts/adapters/custom-csv.mjs`
- Create: `scripts/lib/http.mjs` (UA, pacing, backoff — shared by all adapters)
- Create: `scripts/ingest.mjs`
- Modify: `data/books.ndjson`

## Implementation Steps

1. `scripts/lib/http.mjs`: single `get(url)` with the policy UA, a 1s token
   bucket, and retry on 429/503. Every adapter must route through it.
2. `vi-wikisource.mjs` pass 1: page `list=allpages&apnamespace=0&aplimit=500`
   to exhaustion, following `continue`. Partition on `/`.
3. Pass 2: batch roots 50 at a time through
   `prop=categories&cllimit=max` plus author extraction, mapping subpage counts
   onto their parent.
4. Derive `quality` from the proofread category (`100%`, `75%`, ...) and
   `license` from the licence category (`Creative Commons BY-SA` implies
   CC-BY-SA-4.0, otherwise PD).
5. Build `downloads` entries for epub/pdf/mobi.
6. Cache raw API responses under `.cache/` keyed by request, so re-runs during
   development cost nothing and the API is not re-hit.
7. `custom-csv.mjs`: read `data/custom/*.csv`, map columns to the schema, emit
   with `source: "custom"`. This is where an operator-supplied catalog enters.
8. `scripts/ingest.mjs`: merge, sort by `id`, write, then run the Phase 1
   validator as a gate.
9. Spot-check 20 random records against their live Wikisource pages by hand.

## Success Criteria

- [ ] `books.ndjson` holds every root work; count recorded and plan corrected
- [ ] Zero HTTP 429s across a full cold run
- [ ] `node scripts/validate.mjs` exits 0
- [ ] 20/20 hand-checked records match their live pages
- [ ] Re-running ingest with a warm cache produces a byte-identical file
- [ ] A CSV dropped in `data/custom/` appears in the output

## Risk Assessment

- **Rate limiting (already observed).** Signal: any 429 in the run log.
  Response: lower to 1 req per 2s; if still throttled, request a bot flag.
- **Author extraction is unreliable.** Wikisource has no single author field;
  it varies by template. Signal: null-author rate above ~30%. Response: accept
  null and expose an "unknown author" facet rather than guessing wrong — a wrong
  author is worse than an absent one.
- **`/` in a legitimate title.** A real work could contain a slash and be
  misfiled as a chapter. Signal: a root title with a plausible-parent that does
  not exist. Response: treat a subpage whose parent is missing as a root.
- **Full run exceeds CI time.** Signal: over 15 min. Response: the `.cache/`
  layer plus incremental refresh in Phase 5.
