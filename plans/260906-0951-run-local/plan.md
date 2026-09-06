---
title: "run-local"
description: "Run the whole catalogue on your own machine with no install step, no network, and no third-party service."
status: superseded
# Superseded 2026-09-06 by 260906-1043-epub-first-site. The request became
# "do the best for web on github, only that make sure i can load epub" -- a
# local dev server and PWA are explicitly not that.
priority: P1
effort: "1-2d"
tags: [offline, local-first, pwa, distribution]
created: 2026-09-06
blockedBy: [260906-0936-site-usability-upgrade]
---

# run-local

Make `hong4rc/book` a thing you can clone and run, offline, with nothing
installed beyond Node. Continues the thread from *"i dont want depend on any
else"*: that request removed external services at runtime; this one removes them
from the setup too.

## Where it stands today

Measured, not assumed:

| Fact | Evidence | Consequence |
|---|---|---|
| The site is pure static files | `docs/` is HTML/CSS/ES modules + JSON | No runtime, no build to run it |
| **A server is mandatory** | 1 `<script type="module">` + `fetch()` in 3 modules | `file://` blocks both under CORS — double-clicking `index.html` cannot work |
| `npm run serve` needs the network | it is `npx --yes serve docs` | First run downloads a package; fails offline |
| Node can serve it alone | `node:http` + `node:fs` both present | A ~50-line server removes that dependency entirely |
| Only two external hosts appear | `vi.wikisource.org`, `ws-export.wmcloud.org` | Both are download/read paths, addressed by the blocking plan |
| Clone size | `docs/` 6.2MB + `data/` 6.7MB | ~13MB — small enough to hand someone |

So the gap between "static site" and "runs locally offline" is narrow and
concrete: replace the one install-time dependency, cache the shell in the
browser, and remove the two runtime hosts.

## Relationship to the other plan

**`blockedBy: 260906-0936-site-usability-upgrade`.**

That plan's Phase 7 (self-hosted corpus) puts the book text in the repo and
generates EPUBs in the browser. Until it lands, running locally still reaches
`ws-export.wmcloud.org` to download a book, so "offline" would be a half-truth.

Phases 1-3 here do not depend on it and can ship immediately. **Phase 4 (the
offline guarantee) does**, and must not be marked done before Phase 7 is.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | `node scripts/serve.mjs` works with nothing installed and no network | P1 |
| 2 | The browser keeps working after the first load with the network off | P1 |
| 3 | Clone to reading in one documented command | P2 |
| 4 | Zero requests to any third-party host, proven | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Zero Dependency Server](./phase-01-start.md) | Pending |
| 2 | [Phase 2: Offline Browser Runtime](./phase-02-offline-browser-runtime.md) | Pending |
| 3 | [Phase 3: Quickstart And Distribution](./phase-03-quickstart-and-distribution.md) | Pending |
| 4 | [Phase 4: Verified Offline](./phase-04-verified-offline.md) | Pending |

## Architecture

```
  clone (13MB)                    run                          browse
  ────────────                    ───                          ──────
  git clone  ──────>  node scripts/serve.mjs  ──────>  http://localhost:8080
                      (node:http + node:fs,                     │
                       zero dependencies)                       │ first visit
                                                                ▼
                                                        service worker caches
                                                        shell + index + shards
                                                                │
                                                                ▼
                                                     network off: still works
```

Nothing is added to the deployed site that GitHub Pages cannot serve: the same
`docs/` directory works both ways. The local server is a convenience for running
it off a disk, not a second implementation.

## Success Criteria

- [ ] `node scripts/serve.mjs` starts with no `npm install` and no network
- [ ] Correct MIME types; ES modules and JSON load without console errors
- [ ] Search, browse, bookmarks, and offline books work with the network off
- [ ] Service worker updates cleanly rather than pinning a stale build
- [ ] README documents clone-to-reading in one command
- [ ] A clean checkout on a machine with no npm cache works
- [ ] **Zero requests to any non-localhost host**, asserted by a test
- [ ] The published GitHub Pages site is unaffected

## Non-Goals

- No Electron, Tauri, or desktop packaging — a browser is the reader
- No rewrite of the site for local use; one codebase serves both
- No bundler or build step for *running*; builds remain a maintainer task

## Risks

| Risk | Signal it broke | Response |
|---|---|---|
| Service worker serves a stale build forever | Edits do not appear after reload | Version the cache, `skipWaiting` on activate, and a visible "update available" path |
| Service worker breaks the hosted site | Pages users see stale content | Same versioning; test on Pages before relying on it locally |
| Hand-rolled server has a path-traversal hole | `../` escapes `docs/` | Resolve and verify the path is inside the root; add a test for `..` |
| "Offline" claimed while ws-export is still used | A download fails with the network off | Phase 4 blocks on the other plan's Phase 7; do not tick it early |
| Windows path handling differs | Works on one OS only | The project is developed on Windows; test both separators |
