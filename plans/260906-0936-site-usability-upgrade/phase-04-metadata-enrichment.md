---
phase: 4
title: "Metadata Enrichment"
status: pending
priority: P2
effort: "5h"
dependencies: [2]
---

# Phase 4: Metadata Enrichment

## Overview

Add the per-book context the detail panel currently lacks. The request was
"Tóm tắt" (summary) and image preview; measurement shows neither exists in this
corpus, so this phase delivers what the data can actually support and says
plainly what it cannot.

## Requirements

- Functional: an opening excerpt per work; a Wikidata description where one
  exists; a real thumbnail where one exists; publication year where derivable.
- Non-functional: one batched re-ingest reusing `.cache/`; the search index must
  not grow past the 500KB initial-load budget.

## Architecture

### What was measured (300 random works)

| Field | API | Coverage | Usable |
|---|---|---|---|
| Summary | `prop=extracts` | **0.0%** | No |
| Cover image | `prop=pageimages` | **0.3%** | No |
| Any non-SVG image | `prop=images` | 6% | Mostly shared/irrelevant |
| ProofreadPage scan | — | **0%** | No |
| Wikidata item | `pageprops.wikibase_item` | 7.3% | Marginal, use where present |

**TextExtracts cannot work here.** It returns an article's lead paragraph, but a
Wikisource page *is the work*, with no lead to extract. *Truyện Kiều* returned
empty; *Sĩ* returned the string `==== Chú thích ====`. This is structural, not a
tuning problem.

### What replaces the summary: an opening excerpt

The work's own first lines, fetched once at ingest and stored truncated
(~200 characters, cut on a word boundary).

For a poetry-heavy catalogue this is arguably **more** useful than a synopsis —
the reader sees the actual opening couplet and judges the register directly.

It must be **labelled as an excerpt, never as "Tóm tắt".** Presenting the first
lines as a summary would be a straightforward lie about what the reader is
seeing, and the plan's own honesty rule forbids it. Suggested label:
*"Trích đoạn mở đầu"*.

All works here are public domain or CC BY-SA, so storing a short opening snippet
for catalogue preview is fine; keeping it short also keeps the index small.

### Fields added

| Field | Source | Expected coverage |
|---|---|---|
| `excerpt` | `prop=revisions` lead text, cleaned of wiki markup, truncated | ~100% |
| `description` | Wikidata item description (vi, then en) | ~7% |
| `thumbnail` | PageImages / Wikidata P18 | ~0.3% |
| `year` | Wikidata P577, else the `Tác phẩm YYYY` category already in `rawCategories` | ~40% (year categories are common and already ingested) |

`year` is the quiet win: publication-year categories were **rejected as
maintenance noise in the original taxonomy work**, but they are already sitting
in `rawCategories` on every record. No API call needed — parse what is on disk.
That enables sorting and filtering by period, which a literature catalogue wants.

### Index size

`excerpt` must go in the **shard**, not the search index. The index is loaded on
every visit; shards load only when a book is opened. Roughly 6,482 × 200 bytes
is ~1.3MB of excerpts — fine spread across 33 shards, fatal in the index.

## Related Code Files

- Modify: `scripts/adapters/vi-wikisource.mjs` — excerpt, description, thumbnail
- Modify: `scripts/derive-facets.mjs` — parse `year` from existing rawCategories
- Modify: `schema/book.schema.json` — new optional fields
- Modify: `scripts/build-index.mjs` — excerpt into shards, never the index
- Modify: `docs/book.mjs` — render excerpt, description, year
- Modify: `data/books.ndjson`

## Implementation Steps

1. Extend the schema with `excerpt`, `description`, `thumbnail`, `year`, all
   optional so existing records stay valid.
2. **Parse `year` from `rawCategories` first** — it is pure local computation
   over data already on disk and needs no network at all.
3. Add a third ingest pass: batched `prop=revisions|pageimages|pageprops`,
   50 titles per request, through the existing rate-limited client.
4. Strip wiki markup from the lead text (templates, refs, headings), collapse
   whitespace, truncate at ~200 chars on a word boundary. Discard results that
   are only a heading — the `Sĩ` case proves that shape occurs.
5. Fetch Wikidata descriptions for the ~7% with an item, in one batched call to
   `wikidata.org/w/api.php`.
6. Put `excerpt` in shards; keep the index to title/author/folded/categories.
7. Render in the detail panel: excerpt under the metadata line, clearly labelled;
   description as a subtitle when present; year in the metadata line.
8. Re-run validate, build, and both smoke tests; confirm index size held.

## Success Criteria

- [ ] ≥95% of works have a non-empty, non-heading excerpt
- [ ] Excerpt is labelled as an excerpt; the word "Tóm tắt" appears nowhere for it
- [ ] `year` populated for ≥35% with zero extra API calls
- [ ] Wikidata description shown where present, absent cleanly where not
- [ ] Search index stays under 700KB raw; initial load under 500KB gzipped
- [ ] Ingest completes with zero 429s

## Risk Assessment

- **Markup stripping leaves artefacts.** Wikisource templates are varied; naive
  stripping yields fragments. Signal: excerpts containing `{{`, `==`, or ref
  markers. Response: assert on a 50-record sample in CI and reject records whose
  excerpt is under 40 chars or starts with punctuation, rather than shipping
  garbage into the UI.
- **Re-ingest is another long run.** Signal: over an hour. Response: `.cache/`
  makes pass 1 and 2 free; only the new pass hits the network.
- **Excerpts inflate the payload.** Signal: initial load over 500KB. Response:
  they belong in shards; if a shard grows unwieldy, cut the excerpt to 120 chars.
- **Excerpt read as a summary anyway.** Signal: user feedback repeating the
  request. Response: this is a labelling problem, not a data one — say plainly in
  the UI that no summaries exist for this corpus.
