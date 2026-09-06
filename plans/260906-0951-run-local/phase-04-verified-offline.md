---
phase: 4
title: "Verified Offline"
status: pending
priority: P1
effort: "3h"
dependencies: [1, 2]
---

# Phase 4: Verified Offline

# BLOCKED until `260906-0936-site-usability-upgrade` Phase 7 lands

## Overview

Prove the claim rather than assert it: no request to any host other than
localhost, in any flow the site offers.

**This phase must not be marked done before the self-hosted corpus exists.**
Until then, downloading a book still reaches `ws-export.wmcloud.org`, and
calling the app offline would be false.

## Requirements

- Functional: every flow — search, browse, detail, read, download — completes
  with no network.
- Non-functional: enforced by an automated check, not a manual pass.

## Architecture

**The two hosts to eliminate.** A scan of the shipped site finds exactly two
external references:

| Host | Used for | Removed by |
|---|---|---|
| `ws-export.wmcloud.org` | EPUB download | Other plan, Phase 7 — in-browser EPUB generation |
| `vi.wikisource.org` | source links, reader fetch | Phase 7 stores text locally; the link stays as an outbound *link*, which is fine |

The distinction matters: an `<a href>` a user may click is not a runtime
dependency. A `fetch()` needed to render is. Only the latter must go.

**Two layers of verification**, because each catches what the other misses:

1. **Static scan.** Grep the shipped `docs/` for `http://` and `https://` and
   assert every hit is either an outbound link or explicitly allowlisted. Cheap,
   runs in CI, catches a reintroduced dependency at review time.
2. **Runtime check.** In the DOM test, stub `fetch` to throw on any non-relative
   URL, then drive search, open a book, and read. Any external call fails the
   test loudly.

The runtime layer is the one that matters, because a dependency added in a code
path rather than a literal string will not show up in a grep.

**Honest boundary.** jsdom is not a browser: it cannot exercise the service
worker, and its `fetch` is ours to stub. So the automated checks prove *the app
makes no external calls*, not *the browser makes none*. A real-browser pass with
the network disabled is a separate, manual step, and the README should record
when it was last done rather than implying continuous coverage.

## Related Code Files

- Create: `scripts/check-offline.mjs` — static host scan
- Modify: `scripts/smoke-dom.mjs` — fetch guard around every flow
- Modify: `.github/workflows/ci.yml` — run both (needs the `workflow` scope)
- Modify: `README.md` — state what is and is not verified

## Implementation Steps

1. `check-offline.mjs`: scan `docs/**` for absolute URLs; classify each as an
   outbound link (allowed) or a fetch target (fails). Allowlist by exact URL,
   with a comment for each entry.
2. Extend the DOM test with a `fetch` guard that throws on anything not
   relative, installed before the app boots.
3. Drive every flow under the guard: search, facet, open detail, open a related
   book, trigger a download, open the reader.
4. Assert the guard never fired.
5. Wire both into `npm test` and CI.
6. Manual pass in a real browser with the network disabled; record the date and
   the browser in the README.
7. State plainly in the README what is automated and what is manual.

## Success Criteria

- [ ] Static scan reports zero unallowlisted external fetch targets
- [ ] DOM test drives every flow with a fetch guard armed and never fires it
- [ ] Both run in CI
- [ ] A manual network-off browser pass is recorded with date and browser
- [ ] README distinguishes automated from manual verification
- [ ] Phase 7 of the blocking plan is complete before this phase closes

## Risk Assessment

- **Declaring victory early.** The strongest temptation here: the tests pass
  because they only cover flows that were already local. Signal: this phase
  ticked while Phase 7 is open. Response: the dependency is recorded in
  frontmatter and repeated at the top of this file.
- **Allowlist becomes a rug.** Entries added to make CI green re-admit the
  dependency. Signal: the allowlist grows. Response: each entry carries a
  comment justifying it, and additions are reviewed as a design change.
- **jsdom over-promises.** Signal: green suite, broken real browser. Response:
  say explicitly what is not covered; a manual pass is required and dated.
- **CI cannot run this yet.** The `workflow` scope is still missing, so
  `ci.yml` is uncommitted. Signal: checks exist but never run on a PR.
  Response: they run locally via `npm test` regardless; wire into CI once
  `gh auth refresh -s workflow` is done.
