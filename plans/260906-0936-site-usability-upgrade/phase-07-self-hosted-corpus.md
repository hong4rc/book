---
phase: 7
title: "Self Hosted Corpus"
status: pending
priority: P1
effort: "10h"
dependencies: [1]
---

# Phase 7: Self Hosted Corpus

## Overview

Store the actual book text in this repository so the site depends on no external
service at runtime. Reading and downloading both become self-contained; Wikimedia
is touched only by the periodic refresh.

Requested directly: *"i dont want depend on any else."*

## Why this is possible, when it looked like it was not

The original design linked rather than mirrored, on the measured ground that
6,482 EPUBs is ~28GB against a ~1GB GitHub limit. That number was correct but
**about the wrong thing**: 97% of an EPUB here is four repeated embedded fonts.
The literature itself is small.

The earlier conclusion was an artefact of measuring the packaging instead of the
content.

**Measured across all 6,482 works (2026-09-06).** An initial projection from 60
samples put this at 21MB raw / 8MB gzipped. The enrichment run then fetched every
work, making the real figure measurable:

| | Projected (60 samples) | **Actual (all 6,482)** |
|---|---|---|
| Raw | 21 MB | **48.8 MB** |
| Gzipped | 8 MB | **14.2 MB** |
| Avg per work | 3.3 KB | 7.7 KB |
| Largest work | — | 350 KB |

The projection was **2.3x low** — the heavy tail flagged as a risk was heavier
than allowed for. The conclusion is unchanged: 14.2MB gzipped is trivial against
a ~1GB limit, and no single work approaches the 100MB file cap.

**The corpus is already downloaded.** `.cache/` holds all 6,482 works (57MB of
API responses). Phase 7 can be built entirely from cache with **zero further
requests to Wikimedia** — steps 1 and 2 below are local transforms, not fetches.
Chapter subpages are not yet cached and would need fetching if their text is
wanted; root works alone are complete.

## Licensing — the precondition

99.7% of the corpus is public domain; 0.3% is CC BY-SA 4.0. Redistribution is
permitted for both, but CC BY-SA is **conditional**:

- attribute Vietnamese Wikisource and link the source page;
- keep the licence notice with the text;
- license our copy of that content under CC BY-SA 4.0.

This is why storing the text is legitimate where mirroring a commercial
catalogue was not — the licence explicitly allows it, provided the conditions
are met. They must be met per work, not once in a footer, and the repo LICENSE
must state that catalogued *content* is separate from the MIT code licence.

## Architecture

```
refresh (occasional)          repo (self-contained)        runtime (no network)
────────────────────          ─────────────────────        ────────────────────
vi.wikisource API  ──────>    data/text/NN.json      ──>   reader renders local
  wikitext                    (sharded, sanitized)         epub built in-browser
                                                           download = blob save
```

**Store sanitized HTML, not wikitext.** Converting wikitext to HTML in the
browser would mean shipping a parser; converting at ingest via `action=parse`
means the browser receives ready-to-render markup. Sanitize at **ingest** with
the Phase 6 allowlist, so untrusted markup never reaches a visitor at all — a
stronger position than sanitizing client-side.

**Sharding.** Text shards are separate from metadata shards and fetched only when
a book is opened. Target ~200KB per shard so a reader downloads one small file.
Long works get their own shard.

**EPUB generation in-browser.** `fflate` is already vendored for font-stripping,
and it zips as well as unzips. Building a minimal EPUB (mimetype stored first,
container.xml, one XHTML, content.opf, nav) from stored text removes the
ws-export dependency for downloads too. No fonts embedded — the 4.35MB problem
never returns.

## Related Code Files

- Create: `scripts/fetch-text.mjs` — fetch, sanitize, shard
- Create: `scripts/lib/sanitize-node.mjs` — ingest-side allowlist sanitizer
- Create: `docs/epub.mjs` — build an EPUB in the browser from stored text
- Modify: `docs/reader.mjs` (Phase 6) — read local shards, not the live API
- Modify: `docs/book.mjs` — downloads become local generation
- Modify: `.gitignore`, `README.md`, `LICENSE` — content provenance and licence

## Implementation Steps

1. `fetch-text.mjs`: batched `action=parse&prop=text` through the existing
   rate-limited client, reusing `.cache/`.
2. Sanitize at ingest with the allowlist (tags, `on*` stripped, non-https URLs
   dropped, protocol-relative rewritten). Store the result.
3. **Record the real total size** and correct the estimate above from it. If it
   exceeds ~200MB, shard more aggressively or store text gzipped as base64.
4. Shard to ~200KB; write a manifest mapping ordinal to shard.
5. Point the Phase 6 reader at local shards; delete the live-fetch path.
6. `docs/epub.mjs`: assemble a spec-valid EPUB with `fflate` — `mimetype` first
   and STORED, per OCF. Reuse the assertion from the offline repack.
7. Downloads become a generated blob; keep the ws-export and Wikisource links as
   clearly-labelled alternates rather than the primary path.
8. Per-work attribution and licence rendered in the reader and embedded in every
   generated EPUB.
9. Verify a generated EPUB opens in a real reader.

## Success Criteria

- [ ] Every work's text is in the repo and renders with no external request
- [ ] Real corpus size recorded; estimate corrected from it
- [ ] Repo stays under 300MB; no file over 100MB
- [ ] Generated EPUB opens in at least two readers
- [ ] Reader works fully offline after first load
- [ ] Attribution and licence shown per work and embedded in generated EPUBs
- [ ] No runtime request to any third-party domain
- [ ] `npm test` green, including a sanitizer hostile-input suite

## Risk Assessment

- **Corpus larger than projected.** The 3.3KB mean came from 60 samples with a
  heavy tail. Signal: total over ~200MB. Response: store gzipped, drop chapter
  text for the longest works, or fall back to fetching those on demand — the
  shard boundary makes this a per-work decision, not all-or-nothing.
- **Sanitizing at ingest hides bugs.** A bad sanitizer bakes bad markup into the
  repo permanently. Signal: hostile-input tests fail. Response: same allowlist
  suite as Phase 6, run in CI, plus a second client-side pass — defence in depth
  costs little here.
- **Generated EPUBs are subtly invalid.** Signal: a reader rejects one.
  Response: assert OCF structure after building, and keep ws-export links as a
  labelled alternate so a download path always exists.
- **Repo becomes slow to clone.** Signal: clone over a minute. Response: text
  shards are static and compress well; if it bites, they can move to a release
  asset or a separate data branch fetched by the site.
- **Licence conditions missed.** Signal: a CC BY-SA work rendered without
  attribution. Response: attribution is generated from the record, not authored
  per page, so it cannot be forgotten for an individual work.
