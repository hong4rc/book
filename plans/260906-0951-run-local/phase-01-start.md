---
phase: 1
title: "Zero Dependency Server"
status: pending
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Zero Dependency Server

## Overview

Replace `npx --yes serve docs` with a small Node script that uses only built-in
modules, so the site runs from a fresh clone with nothing installed and no
network.

## Requirements

- Functional: serve `docs/` over HTTP with correct MIME types; configurable port;
  clear startup output naming the URL.
- Non-functional: zero dependencies; Node 20+; works on Windows and POSIX; safe
  against path traversal.

## Architecture

**Why a server is required at all.** The site uses one
`<script type="module">` and `fetch()` in three modules. Browsers block both
under `file://` as cross-origin, so opening `index.html` by double-click cannot
work — no amount of packaging changes that. A local HTTP origin is mandatory.

**Why not `npx serve`.** It downloads a package on first use. On a machine with
a cold npx cache and no network — exactly the situation "run local" targets — it
fails. That is a real dependency, not a nominal one.

**Why built-ins suffice.** `node:http` and `node:fs` are both present and this
is a static file server: read a path, set a content type, stream the bytes.
Roughly 50 lines. Reaching for Express here would add a dependency tree to avoid
writing a `switch` over file extensions.

Design points that actually matter:

| Concern | Approach |
|---|---|
| Path traversal | `path.resolve` the request against the root, then verify the result is still inside it. Reject otherwise — this is the one security-relevant line in the file. |
| MIME types | A small map. `.mjs` **must** be `text/javascript` or the browser refuses the module. |
| Directory requests | `/` and any directory serve `index.html`. |
| Missing files | 404 with a plain message, not a stack trace. |
| Port in use | Catch `EADDRINUSE` and say which port, rather than an unhandled throw. |
| Caching | `no-cache` locally so edits appear immediately; the service worker (Phase 2) handles real caching. |

Hash-based routing means no SPA rewrite rule is needed: every URL the app uses
is `index.html` plus a fragment, and fragments never reach the server.

## Related Code Files

- Create: `scripts/serve.mjs`
- Modify: `package.json` — `serve` and `start` scripts
- Modify: `README.md` — running locally
- Create: `scripts/smoke-serve.mjs` — server tests

## Implementation Steps

1. Write `scripts/serve.mjs`: `createServer`, resolve within `docs/`, extension
   to MIME map, `createReadStream` to the response.
2. Implement the containment check and make it the first thing the handler does.
3. Serve `index.html` for `/` and directory paths.
4. Port from `--port` or `PORT`, defaulting to 8080; handle `EADDRINUSE`.
5. Print the URL on start.
6. Point `npm run serve` at it and add `npm start` as the friendly alias.
7. `scripts/smoke-serve.mjs`: start on an ephemeral port and assert `/` is 200
   HTML, `/app.mjs` is 200 `text/javascript`, `/data/index.json` is 200 JSON,
   a missing path is 404, and **`/../package.json` is rejected**.
8. Add it to `npm test`.

## Success Criteria

- [ ] `node scripts/serve.mjs` runs on a clone with no `node_modules`
- [ ] Works with the network disconnected
- [ ] `.mjs` served as `text/javascript`; no module MIME errors in console
- [ ] Search and browse work end to end against it
- [ ] Traversal attempt rejected, covered by a test
- [ ] Busy port reports a readable message
- [ ] Runs on Windows and POSIX

## Risk Assessment

- **Path traversal.** The only genuine security concern in this phase, since the
  server reads whatever path it is handed. Signal: the traversal test fails.
  Response: resolve-then-verify containment, never string matching on `..`,
  which is defeated by encoding.
- **MIME mistakes are silent-ish.** A wrong type for `.mjs` fails the module
  with a console error and a blank page. Signal: blank page, module error.
  Response: the smoke test asserts the header rather than eyeballing it.
- **Windows separators.** Signal: 404s for files that exist. Response: use
  `node:path` throughout and test on both.
- **Scope creep into a real server.** Range requests, compression and directory
  listings are all tempting. Response: none are needed to read a static
  catalogue; leave them out until something actually requires one.
