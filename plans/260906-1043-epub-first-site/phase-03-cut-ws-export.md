---
phase: 3
title: "Cut Ws Export"
status: pending
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 3: Cut Ws Export

## Overview

Point every download at the local EPUB and remove the ws-export dependency from
the runtime. Only meaningful once Phase 1 has proven the local files work, hence
the hard dependency.

## Requirements

- Functional: downloads serve `docs/epub/`; "Save offline" works; reading a book
  in the browser uses the local file.
- Non-functional: no runtime request to any third-party host for any download or
  read path; the site works with `ws-export.wmcloud.org` unreachable.

## Architecture

### What is actually broken today

Three separate problems, all verified:

| | |
|---|---|
| **No CORS** | ws-export sends no `access-control-allow-origin` header. `docs/offline.mjs:136` does a bare `fetch(url)` on it, so **"Save offline" has never worked in a browser** — it was written and tested only in Node. |
| **Anubis bot-wall** | A JS proof-of-work now fronts the service; scripted access returns a challenge page instead of a file. |
| **Two readers, one field** | `safeUrl()` guards `downloads[].url` in `downloadRow`, but `offlineControls` re-selects the same field 25 lines away and passes it to `fetch` unguarded. One untrusted field, two trust policies. |

Phase 1 removes the cause of all three: the file is local.

### The change

- `downloads[]` gains a local `epub` entry resolved through the Phase 1
  manifest. It becomes the **primary** and only self-hosted format.
- `offline.save()` fetches the **local** URL — same-origin, so no CORS, no
  bot-wall, and the feature works for the first time.
- Move the URL guard to the trust boundary: filter `downloads[]` and normalize
  `thumbnail` once inside `getBook()`, so every consumer sees vetted values
  rather than each call site remembering to check.
- ws-export and Wikisource links stay as **clearly labelled external
  alternates**, not the primary path. An `<a href>` a user may click is not a
  runtime dependency; a `fetch` needed to render is. That distinction is the
  whole test in Step 4.

### pdf and mobi

Every record carries three ws-export URLs — epub, pdf and mobi — so 12,964
pdf/mobi links remain after epub is localized. The request was "make sure i can
load epub", so **pdf and mobi are not self-hosted**. They stay as labelled
external links, and the "no third-party requests" claim is scoped honestly to
what is actually self-hosted rather than stated absolutely.

## Related Code Files

- Modify: `docs/book.mjs` — local epub first; guard at `getBook()`
- Modify: `docs/offline.mjs` — fetch local; drop the ws-export path
- Modify: `scripts/build-index.mjs` — local epub URL into shards
- Create: `scripts/check-offline.mjs` — third-party reference scan
- Modify: `scripts/smoke-dom.mjs`

## Implementation Steps

1. Emit the local epub URL into each shard, resolved via the manifest.
2. Make it the primary download; demote ws-export/Wikisource to labelled
   alternates.
3. Move `safeUrl()` into `getBook()` so `downloads[]` and `thumbnail` are vetted
   once at the boundary.
4. `check-offline.mjs`: scan `docs/**/*.mjs` and `index.html` for absolute URLs
   and fail on any that is a **fetch target**. Scope the scan to code — the
   shards legitimately contain ~26,000 absolute URLs as link *data*, so scanning
   `docs/data` would produce 26k false positives and force an allowlist that
   defeats the check.
5. Extend the DOM test with a `fetch` guard that throws on any non-relative URL,
   armed across search, open, download and save-offline.
6. Verify "Save offline" works — it never has.
7. Manual pass with the network off after first load; record date and browser.

## Success Criteria

- [ ] Downloads serve local files; work with ws-export unreachable
- [ ] "Save offline" works in a real browser
- [ ] No `fetch` to any third-party host in any flow
- [ ] `check-offline.mjs` scans code, not data, and passes
- [ ] DOM fetch-guard armed across every flow and never fires
- [ ] pdf/mobi clearly labelled as external
- [ ] README states precisely what is self-hosted and what is not

## Risk Assessment

- **Claiming "zero third-party requests" too broadly.** pdf/mobi links and any
  retained Wikimedia thumbnails are still third-party. Signal: the README says
  "zero" while 12,964 external links ship. Response: scope the claim to epub
  downloads and reading, which is what was asked for.
- **The fetch guard cannot see navigations.** `<a href>` downloads and
  `<img src>` do not go through `fetch`, so a guard that stubs `fetch` proves
  less than it appears to. Signal: guard green while external requests still
  happen. Response: the static scan covers what the runtime guard structurally
  cannot; both are needed and neither alone is sufficient.
- **Removing the ws-export path before local files are proven.** Signal: a
  download 404s. Response: the `dependencies: [1]` edge exists for this; Phase 1
  must have opened generated EPUBs in two real readers first.
