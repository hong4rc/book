---
phase: 5
title: "Reviews Decision"
status: completed
priority: P3
effort: "1h decision, 3h if adopted"
dependencies: []
---

# Phase 5: Reviews Decision

## DECISION: Option A — dropped (2026-09-06)

Operator chose to drop reviews. The catalogue stays a pure static artefact: no
moderation duty, no spam surface, no accounts, no third-party script, and the
"no real backend" constraint holds without qualification.

Rationale: reviews are user-generated content with no source to seed them, and
empty comment boxes under 6,482 books read worse than having none. Revisit only
if the site attracts enough traffic that threads would actually fill.

No code changes. README notes reviews as deliberately out of scope.

## Overview

A decision gate, not an implementation. "Review" was requested alongside summary
and cover art, but unlike those it is not a data-availability problem — it is an
architecture problem, and it contradicts a constraint set at the project's start.

**No work happens in this phase until the operator picks an option.**

## The conflict, stated plainly

Reviews are **user-generated content**. Displaying them requires reading writes
from somewhere; collecting them requires accepting writes. The catalogue's
founding constraint, set in the original request, was "not real backend" — and
that is what makes the whole thing free, fast, and maintenance-free.

There is no source to scrape: Wikisource carries texts, not reviews, and the
7.3% of works with Wikidata items have structured facts, not criticism.

So this cannot be delivered the way summaries or covers can. It is a genuine
fork, and picking one silently would be the wrong call.

## Options

### A. Drop it

Do nothing. The catalogue stays a pure static artefact: no moderation duty, no
spam, no accounts, no privacy surface, nothing to run.

Worth weighing seriously — a 6,482-item public-domain catalogue is a reference
tool, and reference tools rarely need comment threads. Traffic must be
substantial before reviews are anything but empty boxes under every book, which
looks worse than having none.

### B. giscus, backed by GitHub Discussions (recommended if reviews are wanted)

[giscus](https://giscus.app) renders a comment thread per page and stores it in
this repo's GitHub Discussions.

- No server of ours: GitHub holds the data, honouring the original constraint in
  substance rather than by technicality.
- Moderation, spam handling, and accounts are GitHub's, already solved.
- One `<script>` tag plus a per-book mapping term.

Costs, honestly: commenters need a GitHub account, which is a real barrier for a
Vietnamese-literature audience; it adds a third-party script and a network
request to a page that currently makes none; and it is not really "reviews" —
it is a comment thread.

### C. Ratings only, stored per-device

A 1-5 star control persisted in `localStorage`, exactly like bookmarks.

Fully offline and private, but **the rating is visible only to the person who
made it**. No aggregate is possible without shared storage. That is a personal
reading log, not a review system, and it should be labelled as such — presenting
a private star as if it were a community rating would mislead.

### D. Link out

Send readers to an existing discussion venue (Goodreads, a Wikisource talk page)
rather than hosting anything.

## Recommendation

**A (drop) unless reviews are a real goal for you**, in which case **B (giscus)**.

C is worth adding independently of this decision if you want to mark what you
have read, but it should ship as "My rating", never as "Reviews".

## Related Code Files

Only if B is chosen:
- Modify: `docs/book.mjs` — mount the thread in the detail panel
- Modify: `docs/index.html` — script tag
- Modify: `README.md` — say where comments are stored and under what policy

## Implementation Steps

1. **Operator picks an option.** Nothing below runs before that.
2. If B: enable Discussions on `hong4rc/book`, configure giscus, map by book
   ordinal, and load the script lazily so it costs nothing until a book is open.
3. If B: state in the README that comments live in GitHub Discussions and are
   subject to GitHub's terms.
4. If C: a `docs/rating.mjs` mirroring `bookmarks.mjs`, labelled "My rating".
5. Record the decision and its rationale in this file.

## Success Criteria

- [ ] A decision is recorded here with reasoning
- [ ] If B: threads load lazily and the page still works with the script blocked
- [ ] If C: the UI never implies a private rating is a community score
- [ ] If A: the README notes that reviews are deliberately out of scope

## Risk Assessment

- **Silent default.** The worst outcome is a comment widget appearing because it
  was easy, not because it was chosen. Signal: any of this ships without step 1.
  Response: this phase blocks; there is no default.
- **Empty threads look abandoned.** Signal: every book shows an empty comment box.
  Response: render the thread only on demand behind a "Thảo luận" control.
- **Third-party script on a zero-dependency site.** Signal: the page stops
  working when giscus is blocked. Response: load it lazily and treat failure as
  non-fatal — the catalogue must never depend on it.
- **Moderation burden.** Signal: spam or abuse arrives. Response: GitHub's tools
  handle it, but it is still a duty the operator takes on. Option A has none.
