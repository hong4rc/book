---
title: "static-book-catalog"
description: "Public GitHub repo + Pages site: searchable, faceted catalog of Vietnamese public-domain EPUBs. Metadata in repo, EPUBs generated on demand. No backend."
status: pending
priority: P1
effort: "2-3d"
tags: [ebooks, vietnamese, wikisource, static-site, github-pages, pagefind]
created: 2026-09-05
---

# static-book-catalog

## Overview

Build `hong4rc/book` — a **public GitHub repo** whose GitHub Pages site lets
anyone search Vietnamese books by title, author, and category, then download a
real EPUB. Everything is static: metadata is versioned JSON in the repo, search
runs client-side, and a scheduled Action refreshes the catalog. No server, no
database, no API key.

## Source decision

### Why not dtv-ebook.com.vn

Two blockers, both found by inspection:

1. **`robots.txt` disallows this agent site-wide.** It lists `anthropic-ai`,
   `Claude-Web`, `GPTBot`, `CCBot` under a blanket disallow. Its own inline
   notes also ask that EPUB/MOBI/PDF files be protected from direct fetch.
2. **Redistribution exposure.** Mirroring commercially-published Vietnamese
   ebooks into a public repo under a real identity is a copyright risk no
   catalog design mitigates.

### Chosen source: Vietnamese Wikisource

Probed and verified 2026-09-05:

| Source | Verified result | Verdict |
|---|---|---|
| **vi.wikisource.org** | 19,104 articles, 26.1M words (siteinfo API) | **Primary** |
| **ws-export.wmcloud.org** | Returns real EPUB, `application/epub+zip` | **Download path** |
| Project Gutenberg | `languages=vi` yields 0 results | Rejected, no Vietnamese |
| Internet Archive | 2,350 VN texts; sample was lottery pages / junk uploads | Deferred, needs filtering |
| Open Library | 2,295 VN works, metadata only, no EPUB | Optional enrichment |

Wikisource beats the original target on the merits, not merely on safety:
content is public domain or CC BY-SA (**legally redistributable**), there is an
**official EPUB export service**, and a **stable enumeration API** — so the
pipeline never scrapes HTML.

The `custom/` adapter (Phase 2) is the escape hatch: any catalog the operator is
entitled to use drops into the same schema with no pipeline change.

## Decisive constraint: link, never mirror

Four EPUBs were downloaded to measure. Every file is roughly 4.35MB, and the
breakdown of one of them shows why:

```
3.69MB  OPS/fonts/FreeSerif.ttf            -+
2.08MB  OPS/fonts/FreeSerifBold.ttf         |  7.7MB of 8.2MB uncompressed
1.16MB  OPS/fonts/FreeSerifItalic.ttf       |  is the same font set, repeated
0.85MB  OPS/fonts/FreeSerifBoldItalic.ttf  -+  in every single EPUB
0.37MB  OPS/c0_<work>.xhtml                <-  the actual book text
```

**~6,900 works x 4.35MB is roughly 30GB.** GitHub allows about 1-5GB per repo
and 100MB per file. Mirroring EPUBs is *technically impossible*, independent of
licensing.

Therefore: **the repo stores metadata only (a few MB); `ws-export` generates the
EPUB on demand at click time.** Users still get one-click downloads; the repo
stays small enough to clone in seconds.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Public repo `hong4rc/book` + GitHub Pages serving the catalog | P1 |
| 2 | Normalized records for all root works, via API not scraping | P1 |
| 3 | Category taxonomy filtered clean of maintenance noise | P1 |
| 4 | Sub-second client-side search, no backend | P1 |
| 5 | One-click EPUB download per book | P1 |
| 6 | Scheduled Action refreshes data and republishes | P2 |
| 7 | Pluggable adapter for any future licensed catalog | P2 |
| 8 | Bookmarks, offline saving, and related-book discovery | P2 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Repo and Data Contract](./phase-01-start.md) | Completed |
| 2 | [Phase 2: Ingest Adapters](./phase-02-ingest-adapters.md) | Completed |
| 3 | [Phase 3: Category Analysis](./phase-03-category-analysis.md) | Completed |
| 4 | [Phase 4: Static Search Site](./phase-04-static-search-site.md) | Completed |
| 5 | [Phase 5: CI and Publish](./phase-05-ci-and-publish.md) | Blocked (workflow scope) |
| 6 | [Phase 6: Reader Features](./phase-06-reader-features.md) | Implemented, browser-unverified |

## Architecture

```
  vi.wikisource API          normalize             derive            build
  -----------------          ---------             ------            -----
  list=allpages     -+
  prop=categories   -+--> adapters/*.mjs --> data/books.ndjson --> data/facets.json --+
  Open Library (opt)-+        (pure)         (one JSON per line)    (taxonomy)        |
  data/custom/*.csv -+                              |                                 |
                                                    v                                 v
                                           data/shards/NN.json              pagefind index
                                           (detail, lazy-loaded)            (chunked, WASM)
                                                    +-------------+-------------+
                                                                  v
                                                          docs/ -> GitHub Pages
                                                                  |
                                             download click ------+--> ws-export.wmcloud.org
                                                                       (EPUB built on demand)
```

Every arrow is a pure file-to-file transform: each stage re-runs alone, diffs in
a PR, and is reviewable as data.

## Success Criteria

- [ ] `github.com/hong4rc/book` public; Pages serves over HTTPS
- [ ] `data/books.ndjson` holds all root works, schema-valid
- [ ] Search returns results in under 300ms, warm index, mid-range laptop
- [ ] Facets filter by category, author, and completeness
- [ ] Every result yields a working EPUB download
- [ ] Repo clone size under 50MB
- [ ] Full rebuild from empty checkout green in CI in under 15 min
- [ ] Ingest honours Wikimedia UA policy and rate limits
- [ ] `README.md` states provenance and per-source licence

## Non-Goals

- No crawling of any site that disallows it in `robots.txt`
- No EPUB binaries in the repo (30GB; infeasible)
- No user accounts, server-side search, or database

## Risks

| Risk | Signal it broke | Response |
|---|---|---|
| Wikimedia rate limits (**HTTP 429 hit during probing**) | 429/503 from API | Polite UA + 1 req/s + backoff, proven in Phase 2 |
| ws-export slow or down for long works | Timeout or 5xx at click | Link to the Wikisource page as fallback |
| Root-page heuristic misclassifies works | Chapters appear as books | Validate against `prop=categories`; refine in Phase 3 |
| Pagefind bundle too large | Index over 100MB or slow load | Fall back to MiniSearch over title+author only |
| Projected count is off | Real roots far from ~6,900 | Estimate came from an alphabetically-biased sample; recount in Phase 2 |
