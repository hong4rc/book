---
title: "epub-first-site"
description: "Ship the EPUBs as static files from the repo, and make the GitHub Pages site good. Nothing else."
status: pending
priority: P1
effort: "2d"
tags: [epub, github-pages, static, scope-cut]
created: 2026-09-06
supersedes: [260906-0951-run-local, 260906-0936-site-usability-upgrade]
---

# epub-first-site

Requested as: *"do the best for web on github, only that make sure i can load
epub."* Two things, and "only that" is the operative phrase — this plan is a
deliberate cut, not an addition.

## The finding that decides the design

`ws-export.wmcloud.org` — the service every download link on the live site
points at — is now behind **Anubis**, a JavaScript proof-of-work bot-wall
deployed by Wikimedia Cloud Services. Verified 2026-09-06:

```
GET .../?lang=vi&format=epub&page=Truyện_Kiều
  content-type: text/html; charset=utf-8          <- not application/epub+zip
  <title>Making sure you're not a bot!</title>
  set-cookie: techaro.lol-anubis-auth=...
  set-cookie: techaro.lol-anubis-cookie-verification=...
```

The same URL returned a valid 4.4MB EPUB earlier the same day, so this is new.

Consequences, each verified rather than assumed:

| Path | Status |
|---|---|
| `fetch()` from site JS ("Save offline") | **Broken.** No `access-control-allow-origin` header at all — CORS was never enabled. Anubis is a second wall on top. |
| Bulk downloader script | **Broken.** Cannot solve a JS proof-of-work. |
| User clicks a download link in a browser | **Unverified.** Anubis is designed to pass real browsers, but this needs a real browser to confirm and has not been. |

So the one hard requirement — "make sure i can load epub" — currently rests on a
third-party service that has just put a bot-wall in front of itself, over a
connection that has never supported CORS.

## The answer: an EPUB is a ZIP

The previous plan tried to self-host the corpus as HTML and measured **370.8MB**,
breaching its own size criterion. That measurement was correct but pointed at
the wrong artifact.

An EPUB is a zip container. The same corpus, stored as EPUBs:

| | Size |
|---|---|
| Corpus as raw HTML | 370.8 MB (measured) |
| **Corpus as EPUBs** | **~55-74 MB** |
| GitHub Pages cap | 1 GB |
| `docs/` today | 7.4 MB |

Storing the deliverable rather than its source material makes self-hosting
comfortable instead of marginal — and it removes ws-export, Anubis, CORS and the
whole bot-wall problem in one move. The file the user wants *is* the file we
store.

**This is also why the in-browser reader gets simpler, not harder.** A locally
served EPUB can be unzipped and rendered by code already in the repo: `fflate`
is vendored and already used for both directions in `docs/offline.mjs`.

## What this plan cuts

"Only that" is taken literally. Superseded and **not** carried forward:

| Dropped | Why |
|---|---|
| Self-hosted HTML corpus (old Phase 7) | Wrong artifact; 370MB vs 55MB, and EPUBs are what the user asked for |
| Live-fetch reader from Wikimedia (old Phase 6) | Superseded — read the local EPUB instead |
| `run-local` plan (4 phases) | Request is explicitly "web on github". A local server is not that. |
| PWA installability, density toggle, windowed row trimming, A-Z index | Never requested; flagged as unrequested scope by red-team review |
| Duplicate Node-side sanitizer | One sanitizer, one engine |

Roughly 15h of unrequested work and a whole plan's worth of local-first
machinery come out.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Every book downloadable as an EPUB served from this repo | P1 |
| 2 | Zero dependency on ws-export for downloads | P1 |
| 3 | The site reads well: full list, decent layout, covers | P1 |
| 4 | Read a book in the browser from the local EPUB | P2 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Generate And Ship EPUBs](./phase-01-start.md) | Pending |
| 2 | [Phase 2: Site Quality](./phase-02-site-quality.md) | Pending |
| 3 | [Phase 3: Cut Ws Export](./phase-03-cut-ws-export.md) | Pending |

Phase 1 is the hard requirement and everything else can wait behind it. Phase 2
is independent and can run in parallel. Phase 3 closes the loop only after
Phase 1 has proven the local files work.

## Architecture

```
  one-time build (slow, offline after)        repo                 runtime
  ────────────────────────────────────        ────                 ───────
  .cache/ wikitext (48.8MB, already here)
        │
        ├─ wikitext -> XHTML
        ├─ assemble EPUB (fflate, no fonts)
        ▼
  docs/epub/NNNN.epub  (~55-74MB total)  ──>  GitHub Pages  ──>  <a download>
                                                              └─>  read in browser
                                                                   (unzip locally)
```

Nothing at runtime touches a third-party host. No CORS, no proof-of-work, no
rate limit, no bot-wall.

## Licensing

99.7% public domain, 0.3% CC BY-SA 4.0. Redistribution is permitted for both;
CC BY-SA additionally requires attribution, a licence notice, and share-alike.
Every generated EPUB embeds its source URL, author, and licence in its metadata
and on a title page, generated per work so it cannot be forgotten for one.

## Success Criteria

- [ ] Every book has an EPUB in `docs/epub/`, served by Pages
- [ ] A download works with ws-export unreachable
- [ ] A generated EPUB opens in at least two real readers
- [ ] `docs/` stays under 150MB; no file over 100MB
- [ ] Full catalogue browsable, not capped at 100
- [ ] Every result shows a cover
- [ ] Attribution and licence in every EPUB
- [ ] `npm test` green

## Non-Goals

- No local dev server, PWA, or offline-first machinery
- No HTML corpus in the repo
- No pdf/mobi self-hosting — EPUB only, which is what was asked for

## Risks

| Risk | Signal it broke | Response |
|---|---|---|
| Wikitext→XHTML conversion is poor | Generated EPUBs render badly vs ws-export output | Compare 20 against ws-export copies saved before the bot-wall; if quality is unacceptable, fall back to a one-time `action=parse` harvest (~15,890 requests) while it is still reachable |
| Generated EPUBs are structurally invalid | A reader rejects one | Assert OCF structure on every file at build; `mimetype` first and STORED |
| Real corpus exceeds the EPUB estimate | `docs/` over 150MB | The ~55-74MB figure derives from a measured 0.148 compression ratio on this corpus; re-measure after the first 200 and stop if it diverges |
| 6,482 files slow git | Clone or status noticeably slow | Measure at 200 files first; shard into subdirectories by ordinal prefix |
| Anubis also blocks the harvest | Fetches return the challenge page | Already true for scripts. The cached wikitext is the reason this plan does not need to fetch at all |
