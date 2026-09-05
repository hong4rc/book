---
phase: 5
title: "CI and Publish"
status: pending
priority: P2
effort: "4h"
dependencies: [4]
---

# Phase 5: CI and Publish

## Overview

Automate the pipeline: validate on every PR, refresh the catalog on a schedule,
and deploy the site to GitHub Pages. After this phase the catalog maintains
itself.

## Requirements

- Functional: PR checks (schema validation, diacritic fixtures, build); a
  scheduled refresh that opens a PR rather than pushing to `main`; Pages deploy
  on merge.
- Non-functional: full rebuild under 15 minutes; the workflow must not leak the
  contact email in the UA beyond what the repo already publishes.

## Architecture

**Three workflows, deliberately separated:**

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | PR, push to `main` | Validate schema, run fixtures, build index |
| `refresh.yml` | `schedule` weekly + `workflow_dispatch` | Re-ingest, open a PR with the data diff |
| `pages.yml` | push to `main` | Build and deploy to Pages |

**The refresh opens a PR; it never pushes to `main` directly.** Wikisource
content changes upstream, and an automated force-push could silently delete
records if an API call half-fails. A PR makes every catalog change reviewable as
a diff — which is exactly why `books.ndjson` is sorted, one record per line.

**Caching.** `.cache/` from Phase 2 is restored via `actions/cache` keyed by
week, so a scheduled refresh re-fetches only what changed instead of the whole
corpus. This is what keeps the run inside the time budget.

**Concurrency.** Pages deploys use a `concurrency` group so overlapping merges
cannot race and publish a half-built index.

## Related Code Files

- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/refresh.yml`
- Create: `.github/workflows/pages.yml`
- Create: `scripts/check-fixtures.mjs` (diacritic assertions from Phase 4)
- Modify: `README.md` (status badges, refresh cadence)

## Implementation Steps

1. `ci.yml`: Node 20, `npm ci`, run `validate.mjs`, `check-fixtures.mjs`, then
   `build-index.mjs` to prove the index builds. No deploy.
2. `refresh.yml`: weekly cron plus manual dispatch; restore `.cache/`; run
   ingest and facet derivation; if `git diff --quiet` shows no change, exit
   cleanly without a PR; otherwise open one via `peter-evans/create-pull-request`
   with a body summarising added, removed, and changed record counts.
3. `pages.yml`: `actions/configure-pages`, build, `upload-pages-artifact`,
   `deploy-pages`. Set `permissions: pages: write, id-token: write` and a
   `concurrency` group.
4. Put the UA contact string in a repo variable, not hardcoded, so it can change
   without a code edit.
5. Enable branch protection on `main`: require `ci.yml` green.
6. Dry-run `refresh.yml` via `workflow_dispatch`; confirm it opens a sane PR.
7. Add a `CONTRIBUTING.md` explaining that data changes arrive by PR and are
   reviewed as diffs.

## Success Criteria

- [ ] PR check runs and blocks merge on schema or fixture failure
- [ ] Scheduled refresh opens a reviewable PR with a record-count summary
- [ ] A no-change refresh exits without opening an empty PR
- [ ] Pages deploys automatically on merge to `main`
- [ ] Full cold rebuild completes in under 15 minutes
- [ ] Cached refresh completes in under 5 minutes
- [ ] `main` is branch-protected on a green CI

## Risk Assessment

- **A partial API failure silently drops records.** The worst failure mode: a
  half-completed ingest looks like a legitimate deletion. Signal: the refresh PR
  removes an implausible number of records. Response: ingest fails hard if the
  final count drops more than 5% below the previous run, and CI asserts that
  threshold before a PR is ever opened.
- **Scheduled job hammers Wikimedia.** Response: weekly, not daily; cache-first;
  the Phase 2 rate limiter applies unchanged in CI.
- **Pages deploy races.** Signal: a published index that does not match its
  data. Response: concurrency group plus content-hashed filenames.
- **Secrets.** None required — every source is public and unauthenticated. The
  UA contact is already public in the repo, so it is a variable, not a secret,
  and must not be treated as one.
