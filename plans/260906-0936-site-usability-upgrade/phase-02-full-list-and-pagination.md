---
phase: 2
title: "Full List And Pagination"
status: pending
priority: P1
effort: "4h"
dependencies: []
---

# Phase 2: Full List And Pagination

## Overview

Make the whole catalogue reachable. Today the results list is hard-capped at 100
rows, so 6,382 of 6,482 works cannot be browsed to at all — only found by
guessing the right search term.

## Requirements

- Functional: reach any work by browsing; a visible position indicator; the
  current position survives reload and back/forward.
- Non-functional: search stays under the 25ms worst case; no layout jank while
  scrolling; keyboard and screen-reader navigable.

## Architecture

The cap is `RESULT_LIMIT = 100` in `app.mjs`, applied to the search result and
the bookmarks/offline lists alike. The count line already tells the user what is
being withheld ("100 of 6,482 results"), which makes the limitation visible but
not solvable.

**The search is not the bottleneck; the DOM is.** Measured, a full unbounded
scan over 6,482 records is ~2.4-3.8ms. Rendering 6,482 `<li>` elements is what
would hurt. So the cap moves from the *query* to the *rendering*.

**Chosen approach: "Load more". Nothing else.**

- Render a page of 100, append the next 100 on demand.
- The offset lives in the URL hash so a position is shareable and survives back.

**Windowed row-trimming was cut** (red team, 2026-09-06). The earlier draft also
bounded the rendered DOM at ~600 rows by dropping rows off the top — then its
own risk section conceded the fix might be *"raise the window cap until the jump
disappears"*, which is "do not trim". It rejected virtual scrolling for causing
scroll-anchoring bugs and then hand-rolled the same problem. Nobody asked for a
bounded DOM; the request was to see the full list. Ship load-more, measure the
real cost at 6,482 rows, and add bounding only if a measurement demands it.

**`search()` keeps its signature.** The earlier draft threaded an `offset`
through it. It already builds and sorts the complete result array and only
slices at the end, so paging is `results.slice(offset, offset + limit)` in the
caller. More to the point, two of the three paginated lists never call `search()`
at all — bookmarks and offline take a different branch — so an offset parameter
could not have been the shared windowing path the draft claimed. Changing it
would have churned 7 test call sites for a slice the caller can do itself.

Rejected alternatives, with reasons:

| Option | Why not |
|---|---|
| Render all 6,482 | ~6,482 DOM nodes plus layout; slow first paint on mobile for no gain |
| Numbered pages | Reads as a database admin tool, and fights the incremental-search feel |
| Full virtual scroll | Correct at millions of rows; here it costs scroll-anchoring and a11y bugs for a list that is only ~6.5k |

**Browse order must be decided first.** An alphabetical index sounds cheap
because `books.ndjson` is id-sorted — but nothing ever *renders* it in that
order. With an empty query, `search()` scores each record `-title.length` and
sorts by score, so the no-query list is **shortest-titles-first**. Dropping an
A-Z index onto that lands the reader in a length-ordered sequence where
consecutive rows have unrelated initials.

So this phase must first make the no-query list sort by folded title, and assert
that ordering in a test. Only then does a letter index mean anything.

Whether the A-Z index ships at all is an open question for the operator: the
request was "show full list", and load-more alone satisfies it.

## Related Code Files

- Modify: `docs/app.mjs` — `renderResults`, `RESULT_LIMIT`, hash state
- Modify: `docs/search.mjs` — accept an offset, keep returning the true total
- Modify: `docs/index.html` — "load more" control, alphabet index
- Modify: `docs/style.css`
- Modify: `scripts/smoke-dom.mjs`

## Implementation Steps

1. Change `search()` to take `{offset, limit}` and keep returning the uncapped
   `total`. The scan is already single-pass; do not add a second one.
2. `renderResults` appends rather than clearing when the offset advances.
3. Add a "load more" button showing what remains ("Xem thêm — còn 6,282").
   A button, not infinite scroll: it keeps the footer reachable and avoids
   hijacking the scrollbar.
4. Bound the rendered window; drop leading rows once past the limit.
5. Persist offset in the hash; restore on load.
6. Add the A-Z / letter index, filtering on the folded first letter so
   Vietnamese diacritics group as a reader expects (Đ with D, Ă with A).
7. Reset offset to zero whenever the query or facets change.
8. Extend the DOM test: assert loading more grows the list and that the total
   line reports the real count.

## Success Criteria

- [ ] Any of the 6,482 works reachable by browsing alone
- [ ] "Load more" advances and the count line stays accurate
- [ ] Rendered rows stay bounded no matter how far the user goes
- [ ] Offset survives reload and back/forward
- [ ] Letter index groups Vietnamese diacritics correctly
- [ ] `smoke-search` worst case still under 25ms
- [ ] Changing query or facet resets to the first page

## Risk Assessment

- **Dropping rows breaks scroll position.** Trimming the top of a list shifts
  everything under the viewport. Signal: the page jumps while loading more.
  Response: compensate `scrollTop` by the removed height, or raise the window
  cap until the jump disappears — correctness beats memory here.
- **Letter index misgroups Vietnamese.** Signal: `Đ` sorts apart from `D`, or
  `Ă` from `A`. Response: group on `fold()`, which already maps both, and cover
  it with the existing folding fixtures.
- **Bookmarks and offline lists were capped too.** Easy to fix search and forget
  those. Response: both go through the same windowing path.
