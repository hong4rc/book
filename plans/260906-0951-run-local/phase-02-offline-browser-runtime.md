---
phase: 2
title: "Offline Browser Runtime"
status: pending
priority: P1
effort: "5h"
dependencies: [1]
---

# Phase 2: Offline Browser Runtime

## Overview

Make the page keep working once the network goes away: cache the app shell and
data with a service worker, and add a web app manifest so it can be installed
like an app.

## Requirements

- Functional: after one visit, search and browse work with the network off;
  installable; an update path that does not strip a stale build.
- Non-functional: must not break the hosted GitHub Pages site; cache growth
  bounded; no third-party code.

## Architecture

**Two different caching jobs, deliberately split:**

| Asset | Strategy | Reason |
|---|---|---|
| Shell (`index.html`, CSS, `.mjs`) | cache-first, versioned | Small, changes only on deploy |
| `data/index.json`, `data/facets.json` | stale-while-revalidate | Needed on every visit; fresh eventually |
| `data/shards/*.json` | cache-on-use | 33 files, only some ever opened; caching all upfront wastes space |

Shards are the interesting case: precaching all 33 would download everything for
a reader who opens three books. Caching on first use converges on exactly what
that person reads.

**Versioning is the whole risk.** A service worker that pins an old build is
worse than none — the site appears frozen and reloading does not help. So:

- cache name carries a build version, bumped by `build-index.mjs`;
- `activate` deletes every cache that is not current;
- `skipWaiting` + `clients.claim` so a new worker takes over promptly;
- **never** cache-first the worker script or `index.html` without revalidation.

Because the same `docs/` is deployed to Pages, this ships to the hosted site
too. That is a feature (the public site gains offline support) but it means a
bad worker breaks production, so it is verified on Pages before being relied on.

**Already-offline pieces.** Bookmarks are in `localStorage` and saved books in
IndexedDB, so both already survive without the network. This phase closes the
gap for the shell and the catalogue data.

## Related Code Files

- Create: `docs/sw.js` — service worker
- Create: `docs/manifest.webmanifest`
- Create: `docs/icon.svg`
- Modify: `docs/index.html` — manifest link, registration
- Modify: `docs/app.mjs` — register, and surface "update available"
- Modify: `scripts/build-index.mjs` — emit the build version
- Modify: `scripts/smoke-dom.mjs`

## Implementation Steps

1. `build-index.mjs` writes a build version (content hash of the index) into
   `docs/data/index.json` and a small `docs/version.js`.
2. `sw.js`: on `install`, precache the shell; on `activate`, delete non-current
   caches and claim clients.
3. Implement `fetch` routing by the table above. Anything not matched goes to
   the network untouched — the worker must not become a general proxy.
4. Register the worker from `app.mjs`, guarded by `'serviceWorker' in navigator`
   and wrapped so a registration failure never breaks the page.
5. On `updatefound`, show an unobtrusive "Bản mới — tải lại" control rather than
   reloading under the reader.
6. Write `manifest.webmanifest` (name, short name, start URL, display, theme
   colours matched to both themes) and a simple SVG icon.
7. Verify: load, go offline, reload — search and browse still work.
8. Extend the DOM test to assert the manifest link and registration guard exist;
   the worker itself is not exercisable in jsdom, which is worth stating rather
   than pretending it is covered.

## Success Criteria

- [ ] Second visit works fully with the network off
- [ ] Shards open offline once visited; unvisited ones fail gracefully
- [ ] A new deploy is picked up without a hard refresh
- [ ] Old caches deleted on activate; storage does not grow unbounded
- [ ] Installable (manifest valid, icon present)
- [ ] Registration failure leaves the page fully working
- [ ] Hosted Pages site verified unaffected

## Risk Assessment

- **Stale cache pins an old build.** The classic service-worker failure and the
  main risk here. Signal: a deploy does not appear after reload. Response:
  versioned cache names, delete-on-activate, `skipWaiting`; and if it happens,
  an unregister path documented in the README.
- **Breaking the public site.** Signal: Pages visitors report stale content.
  Response: verify on Pages before depending on it locally; the worker is
  additive and can be removed in one commit.
- **Caching everything.** Precaching 33 shards plus the index is ~13MB per
  visitor for content most will not open. Response: cache-on-use for shards.
- **jsdom cannot test this.** Signal: false confidence from a green suite.
  Response: assert only what is assertable (registration guard, manifest link)
  and verify the offline behaviour manually in a real browser, recorded as such.
