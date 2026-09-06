---
title: "site-usability-upgrade"
description: "Fix a rendering bug affecting nearly every book, show the whole catalogue instead of 100 results, redesign the layout around generated covers, and add the enrichment that Wikisource can actually supply."
status: pending
priority: P1
effort: "2-3d"
tags: [frontend, ux, wikisource, enrichment]
created: 2026-09-06
blockedBy: []
---

# site-usability-upgrade

Follow-up to `260905-1759-static-book-catalog`, which built and shipped
https://hong4rc.github.io/book/. This plan responds to first real user feedback:
the layout is poor, only part of the catalogue is reachable, a stray `null`
appears on book pages, and the detail view carries too little to be useful.

## The bug, diagnosed

Reported as "why null" on the detail panel for *Sĩ*. Root cause confirmed by
reading the code and reproducing it:

```js
panel.append(
  el('p', { ... }),
  book.isVersionsPage ? el('p', { ... }) : null,   // <- null reaches append()
  ...
  relatedList(book, onOpen),                        // <- returns null when empty
)
```

`el()` filters falsy children, but `panel.append(...)` is a direct
`Node.append()` call that bypasses it — and **`Node.append(null)` stringifies to
a text node reading `null`**. Verified:

```
x.append(<p>, null, <span>)  =>  "<p></p>null<span></span>"
```

`isVersionsPage` is false for **6,474 of 6,482 works**, so this is not an edge
case: nearly every book in the catalogue renders a stray `null`. A second one
appears whenever a book has no related works.

The existing DOM test opened the overlay but never asserted its *contents*,
which is exactly why this shipped. Phase 1 closes both.

## What the data will and will not support

The requests for "Tóm tắt & Review" and "image preview" were measured against
the live API before planning, not assumed. Sample of 300 random works:

| Wanted | Source tried | Coverage | Verdict |
|---|---|---|---|
| Summary | `prop=extracts` (TextExtracts) | **0.0%** | **Unusable** |
| Cover image | `prop=pageimages` (PageImages) | **0.3%** | **Unusable** |
| — | any non-SVG image on page | 6% | Mostly shared/irrelevant (one was an audio file) |
| — | ProofreadPage scans | **0%** | None |
| Structured data | Wikidata item | 7.3% | Marginal, worth using where present |

**Why extracts fail.** TextExtracts pulls an encyclopedia article's lead
paragraph. A Wikisource page *is the work itself*, so there is no lead to pull:
*Truyện Kiều* returned empty, *Sĩ* returned the string `==== Chú thích ====`.
No amount of tuning fixes this — the data does not exist.

**Consequences, stated plainly:**

- A real per-book **summary cannot be built from this corpus.** Phase 4 offers
  an *opening excerpt* instead — the work's own first lines, available for 100%
  of books and genuinely useful for poetry, but labelled honestly as an excerpt
  rather than dressed up as a summary.
- **Cover images must be generated,** not fetched. Phase 3 renders a typographic
  cover per book from title, author, and category: 100% coverage, deterministic,
  no image files, no repo growth. The rare real thumbnail is used when it exists.
- **Reviews have no source at all.** They are user-generated content, which
  needs somewhere to store writes — in direct tension with the project's founding
  "no real backend" constraint. Phase 5 puts that decision to the operator rather
  than silently picking one.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | No stray `null`; detail contents covered by tests | P1 |
| 2 | All 6,482 works reachable, not the first 100 | P1 |
| 3 | Layout that scans quickly and uses the space well | P1 |
| 4 | Every book has a cover, generated where none exists | P2 |
| 5 | Opening excerpt and Wikidata description where available | P2 |
| 6 | An explicit, recorded decision on reviews | P3 |
| 7 | Read a book in the browser, no backend | P1 |
| 8 | Depend on no external service at runtime | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Fix Null Rendering](./phase-01-start.md) | Pending |
| 2 | [Phase 2: Full List And Pagination](./phase-02-full-list-and-pagination.md) | Pending |
| 3 | [Phase 3: Layout Redesign](./phase-03-layout-redesign.md) | Pending |
| 4 | [Phase 4: Metadata Enrichment](./phase-04-metadata-enrichment.md) | Pending |
| 5 | [Phase 5: Reviews Decision](./phase-05-reviews-decision.md) | Decided: dropped |
| 6 | [Phase 6: In Browser Reader](./phase-06-in-browser-reader.md) | Pending |
| 7 | [Phase 7: Self Hosted Corpus](./phase-07-self-hosted-corpus.md) | Pending |

Phases 1 and 2 are independent and can ship immediately. Phases 3 and 6 depend
on 1. Phase 4 requires a re-ingest. Phase 5 was a decision gate and is closed:
**reviews dropped**, keeping the catalogue a pure static artefact.

Phase 6 (in-browser reader) was added after the plan opened, on request, and
verified feasible first: Wikimedia serves `action=parse` with
`access-control-allow-origin: *`.

Phase 7 (self-hosted corpus) then supersedes Phase 6's *source*: rather than
fetching from Wikimedia at read time, the text is stored in this repo and read
locally. Requested as "i dont want depend on any else", and measurement showed
it is possible — the complete corpus is roughly **20MB gzipped**, not the 28GB
the original design assumed. That 28GB figure measured EPUB packaging, of which
97% is repeated embedded fonts; the literature itself is small. Phase 7 also
moves EPUB generation into the browser, removing the last runtime dependency.

## Success Criteria

- [ ] No `null` text node in any detail panel; asserted in CI
- [ ] Every one of the 6,482 works reachable through browsing
- [ ] Search stays under 25ms worst case with the result cap removed
- [ ] Every result and detail view shows a cover
- [ ] Initial page load stays under 500KB gzipped
- [ ] Usable at 360px width; keyboard navigable
- [ ] Reviews decision recorded in this plan with a rationale

## Non-Goals

- No claimed "summary" the data cannot support
- No fetching per-book images at render time from Wikimedia
- No backend of our own (a hosted third-party comment service is a Phase 5 option
  the operator may accept or reject, not a default)

## Risks

| Risk | Signal it broke | Response |
|---|---|---|
| Removing the result cap slows search | Worst case over 25ms in `smoke-search` | Cap the DOM, not the search: windowed rendering (Phase 2) |
| Generated covers look cheap | They read as placeholders rather than design | Derive colour/pattern from category and title hash; review before wiring |
| Excerpts mistaken for summaries | Users read them as descriptions | Label in Vietnamese as an excerpt; never use the word "Tóm tắt" for it |
| Excerpt ingest re-hits the API for 6,482 works | Another multi-hour run | Reuse `.cache/`; batch 50 per request as in the original ingest |
| Reviews decision defaults silently | A comment widget appears without a decision | Phase 5 blocks on the operator; no default |
