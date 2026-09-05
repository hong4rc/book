---
phase: 4
title: "Static Search Site"
status: in-progress
priority: P1
effort: "8h"
dependencies: [3]
---

# Phase 4: Static Search Site

## Overview

The user-facing half: a GitHub Pages site where a visitor types a Vietnamese
title or author, filters by category, and downloads an EPUB — with no backend
anywhere in the path.

## Requirements

- Functional: full-text search over title and author; facet filters from
  `facets.json`; a detail view per book; a download button per format.
- Non-functional: search under 300ms warm; usable on mobile; works with
  JavaScript from the same origin only; **correct Vietnamese diacritic
  handling** in search.

## Architecture

**Search engine: none — a plain linear scan.**

This reverses the original choice of Pagefind, on evidence gathered once the
real corpus size was known. Recorded here rather than silently changed.

Pagefind chunks its index so a browser never loads the whole corpus, which is
the right tool for a large full-text collection. This is not one. The catalogue
holds **6,482 records searching only title and author** — the entire index is
roughly 700KB raw and under 250KB gzipped, a single fetch. Scanning 6,482 short
strings per keystroke costs well under a millisecond, so the machinery that
avoids the scan costs more than the scan.

Adopting it would have added a WASM runtime, an npm dependency, and a build
step to avoid work the browser does not notice doing. The plan's own stated
fallback was the better primary all along; the site ships with **zero runtime
dependencies** for search.

The one real cost: no full-text search inside book contents. The catalogue only
ever indexed title and author, so nothing is lost against the stated scope.

**Diacritics are the central correctness concern.** A Vietnamese reader may type
`truyen kieu` for *Truyện Kiều*. Both must match. The index therefore stores a
folded form (NFD, combining marks stripped) **alongside** the original, and
queries are folded the same way. Folding is used only for *matching* — display
always uses the original, since stripped Vietnamese is a different word.

**Two-tier data load**, keeping first paint small:

- Tier 1: `data/index.json` — title, author, and folded search text only.
- Tier 2: `data/shards/NN.json` — full detail, fetched only when a book is
  opened. Shard by ordinal into files of 200 records.

**Download is a direct link**, built at render time:

```
https://ws-export.wmcloud.org/?lang=vi&format=epub&page=<encoded title>
```

No proxy, no CORS problem: it is a plain navigation, and the service sets
`content-disposition: attachment`, so the browser downloads it. Generation takes
a few seconds for long works, so the UI shows a pending state and offers the
Wikisource page as a fallback link.

Plain HTML, CSS, and ES modules. No framework, no bundler — a static site of
this size does not justify a toolchain.

## Related Code Files

- Create: `site/index.html`, `site/style.css`
- Create: `site/app.mjs` (search, facets, routing)
- Create: `site/book.mjs` (detail view, download links)
- Create: `scripts/build-index.mjs` (compact index + shard writer)
- Create: `site/search.mjs`, `site/fold.mjs` (scan + Vietnamese folding)

## Implementation Steps

1. `build-index.mjs`: read `books.ndjson` and emit a compact index of
   `[title, author, foldedText, categoryIds]` per work.
2. Same script writes `site/data/shards/NN.json` keyed by ordinal, and
   publishes `shardSize` in the index so the layout has one source of truth.
3. `index.html`: search input, facet sidebar, results list. Server-render
   nothing; load the index once on startup.
4. `app.mjs`: fold the query, scan, render. Reflect query and active facets in
   the URL hash so results are shareable and the back button works.
5. `book.mjs`: on result click, fetch the shard, render detail, render one
   download button per format plus a Wikisource source link.
6. Empty, loading, and error states — including ws-export being unreachable.
7. Measure: cold load, warm search latency, transferred bytes. Record in the
   phase notes.
8. Accessibility: label the search input, make facets real checkboxes, ensure
   keyboard navigation through results, check contrast.

## Success Criteria

- [ ] Warm search under 300ms
- [ ] `truyen kieu` (no diacritics) finds *Truyện Kiều*
- [ ] `Truyện Kiều` (with diacritics) finds it too
- [ ] Facet filters narrow results and combine correctly
- [ ] Every detail view yields a working EPUB download
- [ ] Initial page load transfers under 500KB
- [ ] Usable at 360px width
- [ ] Keyboard-navigable; search input labelled

## Risk Assessment

- **Index outgrows a single fetch.** Resolved for now: 6,482 records produce a
  sub-1MB index. Signal: the corpus grows past roughly 50k records, or cold load
  exceeds 3s. Response: shard the index by first folded letter and load lazily,
  or revisit a chunked engine — the scan is easy to replace precisely because
  nothing else depends on how search is implemented.
- **Diacritic folding is wrong.** Highest-likelihood correctness bug in the
  phase. Response: a fixture list of 30 Vietnamese title/query pairs asserted in
  CI, covering every Vietnamese vowel-plus-tone combination.
- **ws-export latency or downtime.** Signal: slow or failed downloads.
  Response: pending state plus an always-present Wikisource fallback link, so a
  download path exists even when the exporter is down.
- **GitHub Pages caching serves a stale index.** Response: content-hashed index
  filenames so a rebuild invalidates cleanly.
