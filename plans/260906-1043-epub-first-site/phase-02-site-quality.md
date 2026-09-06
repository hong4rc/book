---
phase: 2
title: "Site Quality"
status: pending
priority: P1
effort: "8h"
dependencies: []
---

# Phase 2: Site Quality

## Overview

The "do the best for web on github" half: make the whole catalogue reachable,
give every book a cover, and render the enrichment data that is already shipping
but invisible.

Independent of Phase 1 — no EPUB work is required for any of this.

## Requirements

- Functional: all 6,482 works browsable; a cover on every result; excerpt, year
  and description rendered on the detail panel.
- Non-functional: WCAG AA contrast in **both** themes; 44px touch targets;
  usable at 360px; `prefers-reduced-motion` honoured; initial load under 500KB
  transferred.

## Architecture

### Show the whole catalogue

`RESULT_LIMIT = 100` in `docs/app.mjs` caps every list, so 6,382 works are
unreachable by browsing — findable only by guessing a search term.

**"Load more", and nothing else.** The search is not the bottleneck: a full
unbounded scan over 6,482 records measures 2.7ms, because `search()` already
builds and sorts the complete array and only slices at the end. Rendering rows
is the cost, so the cap moves from the query to the rendering.

Two things an earlier draft added are **cut**:

- *Windowed row-trimming* (drop rows off the top past ~600). Its own risk
  section conceded the mitigation might be "raise the cap until the jump
  disappears", i.e. don't trim. It rejected virtual scrolling for causing
  scroll-anchoring bugs, then hand-rolled the same bug. Nobody asked for a
  bounded DOM.
- *Threading an `offset` through `search()`*. Paging is `slice(offset, offset+n)`
  in the caller. More decisively, bookmarks and offline lists never call
  `search()` at all — they take a different branch — so an offset parameter
  could not have been the shared path it claimed to be. It would have churned 7
  test call sites for a slice.

**Browse order must be fixed first.** With an empty query, `search()` scores
each record `-title.length` and sorts by score, so the no-query list is
*shortest-titles-first*. Any "browse the catalogue" affordance sits on top of
that ordering, so this phase makes the no-query list sort by folded title and
asserts it in a test.

### Covers are generated

Real cover art effectively does not exist here: measured **0.3%** coverage
(1 of 300 sampled), and 38 thumbnails corpus-wide. So covers are generated
inline SVG from title, author and category — deterministic per book, zero bytes
on the wire, zero repo growth. The rare real thumbnail is used when present.

Those 38 thumbnails are **live Wikimedia URLs carrying `utm_` tracking
parameters**. Rendering them makes the page issue third-party requests. Either
strip the tracking params and accept the request, or drop them in favour of the
generated cover — a decision this phase must make explicitly rather than inherit.

### Render what is already shipping

Enrichment landed in the shards but **nothing renders it**: `docs/book.mjs`
builds its meta line from author, chapters, quality and licence only. So ~1MB of
excerpts is downloaded by every reader who opens a book and displayed to nobody.

- `excerpt` (71.2%) — labelled **"Trích đoạn mở đầu"**, never "Tóm tắt". It is
  the work's opening lines, not a summary; no summary source exists for this
  corpus (measured 0% usable from `prop=extracts`).
- `year` (47.8%) — into the meta line; enables sorting by period.
- `description` (4.6%) — as a subtitle where present.
- Absent values must render cleanly: 28.8% have no excerpt, and those are mostly
  thin or contents pages that genuinely have no opening to show.

### Typography

If web fonts are used, **self-host the woff2 files**. Loading from
`fonts.googleapis.com` adds two third-party hosts to a site whose whole point is
now that it depends on nobody. Verified separately: **Cinzel has no Vietnamese
subset** and would break accented titles mid-heading; Cormorant Garamond,
Crimson Pro, Lora, Inter and Source Serif 4 all do.

## Related Code Files

- Create: `docs/cover.mjs` — deterministic SVG cover
- Modify: `docs/app.mjs` — load-more, browse ordering, cards
- Modify: `docs/book.mjs` — render excerpt, year, description
- Modify: `docs/search.mjs` — folded-title order for the empty query
- Modify: `docs/style.css`, `docs/index.html`
- Modify: `scripts/smoke-dom.mjs`

## Implementation Steps

1. Sort the no-query list by folded title; assert the order in a test.
2. Replace the hard cap with load-more; keep offset in the URL hash. Reset on
   query or facet change.
3. Apply the same windowing to bookmarks and offline lists — they are a separate
   branch and are easy to fix and forget.
4. `cover.mjs`: `coverSvg({title, author, category})`, deterministic.
5. Decide the 38 thumbnails: strip `utm_` and keep, or drop. Record the choice.
6. Render excerpt, year, description; verify the empty cases.
7. Card grid via `repeat(auto-fill, minmax(...))` — no breakpoint list.
8. If self-hosting fonts, add the woff2 files and measure the load budget.
9. Verify contrast independently in light and dark; test at 360px.
10. Extend the DOM test: cover per card, load-more grows the list, excerpt
    renders, a book without an excerpt renders cleanly.

## Success Criteria

- [ ] All 6,482 works reachable by browsing
- [ ] No-query list ordered by folded title, asserted in a test
- [ ] Bookmarks and offline lists paginate too
- [ ] Every result and detail view shows a cover
- [ ] Excerpt rendered and labelled as an excerpt; "Tóm tắt" appears nowhere
- [ ] Books without an excerpt render cleanly
- [ ] Thumbnail decision recorded
- [ ] Body contrast ≥4.5:1 verified separately per theme
- [ ] No horizontal scroll at 360px; targets ≥44px
- [ ] Initial load under 500KB transferred

## Risk Assessment

- **Grid hurts scanning.** A card grid is worse than a list for finding a known
  title. Signal: browsing feels slower than before. Response: this is why the
  density toggle was cut rather than pre-emptively built — ship one layout,
  measure, and only then consider a second.
- **Generated covers read as placeholders.** Signal: they look like missing
  images. Response: commit to typography as the design; review ~30 as a contact
  sheet before wiring.
- **jsdom cannot see layout.** Signal: green suite, broken page — which has
  already happened once on this project. Response: the DOM test covers structure
  only; contrast, scroll and grid behaviour need a real browser, and that must
  be stated rather than implied by a passing suite.
- **Load budget.** Index is 741KB raw / ~176KB transferred today; fonts would
  add to it. Signal: over 500KB transferred. Response: display face only, system
  stack for body.
