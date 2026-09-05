---
phase: 4
title: "Static Search Site"
status: pending
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

**Search engine: Pagefind.** Chosen over hand-rolling an index because it
chunks its index and loads only the fragments a query needs, so the browser
never downloads the whole corpus. Its Node API indexes records directly:

```js
const { index } = await pagefind.createIndex()
await index.addCustomRecord({ content, meta, filters })  // no HTML files needed
```

This matters: the HTML-crawling mode would require generating ~6,900 static
pages, bloating the repo. `addCustomRecord` gives the same index with none of
that.

**Diacritics are the central correctness concern.** A Vietnamese reader may type
`truyen kieu` for *Truyện Kiều*. Both must match. The index therefore stores a
folded form (NFD, combining marks stripped) **alongside** the original, and
queries are folded the same way. Folding is used only for *matching* — display
always uses the original, since stripped Vietnamese is a different word.

**Two-tier data load**, keeping first paint small:

- Tier 1: Pagefind index — search results carry just id, title, author.
- Tier 2: `data/shards/NN.json` — full detail, fetched only when a book is
  opened. Shard by `id` hash into ~64 files of ~100 records.

**Download is a direct link**, built at render time:

```
https://ws-export.wmcloud.org/?lang=vi&format=epub&page=<encoded title>
```

No proxy, no CORS problem: it is a plain navigation, and the service sets
`content-disposition: attachment`, so the browser downloads it. Generation takes
a few seconds for long works, so the UI shows a pending state and offers the
Wikisource page as a fallback link.

Plain HTML, CSS, and ES modules. No framework and no build step beyond the
Pagefind index — a static site of this size does not justify a toolchain.

## Related Code Files

- Create: `site/index.html`, `site/style.css`
- Create: `site/app.mjs` (search, facets, routing)
- Create: `site/book.mjs` (detail view, download links)
- Create: `scripts/build-index.mjs` (Pagefind custom records + shard writer)
- Create: `site/pagefind/` (generated, committed)

## Implementation Steps

1. `build-index.mjs`: stream `books.ndjson`, add a Pagefind custom record per
   work with `content` = `title + author + folded variants`, and filters for
   category, author, and quality.
2. Same script writes `data/shards/NN.json` keyed by id hash.
3. `index.html`: search input, facet sidebar, results list. Server-render
   nothing; hydrate from Pagefind on load.
4. `app.mjs`: debounce input at ~150ms, fold the query, query Pagefind, render
   results. Reflect query and active facets in the URL hash so results are
   shareable and the back button works.
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

- **Pagefind bundle too large or too many files.** ~6,900 records should be
  comfortable, but this is unverified at this scale. Signal: index over 100MB,
  or cold load over 3s. Response: fall back to a single MiniSearch index over
  title and author only — roughly 6,900 records is a few MB gzipped, entirely
  viable, at the cost of full-text depth.
- **Diacritic folding is wrong.** Highest-likelihood correctness bug in the
  phase. Response: a fixture list of 30 Vietnamese title/query pairs asserted in
  CI, covering every Vietnamese vowel-plus-tone combination.
- **ws-export latency or downtime.** Signal: slow or failed downloads.
  Response: pending state plus an always-present Wikisource fallback link, so a
  download path exists even when the exporter is down.
- **GitHub Pages caching serves a stale index.** Response: content-hashed index
  filenames so a rebuild invalidates cleanly.
