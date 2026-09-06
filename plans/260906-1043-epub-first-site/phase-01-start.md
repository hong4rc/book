---
phase: 1
title: "Generate And Ship EPUBs"
status: pending
priority: P1
effort: "10h"
dependencies: []
---

# Phase 1: Generate And Ship EPUBs

## Overview

Build an EPUB for every work from wikitext already on disk, commit them, and
serve them from GitHub Pages. This is the hard requirement — *"make sure i can
load epub"* — and it is the only phase that must land.

## Requirements

- Functional: one valid EPUB per work in `docs/epub/`, downloadable from Pages
  with no third-party host involved.
- Non-functional: `docs/` stays under 150MB, no file over 100MB, every EPUB
  carries its attribution and licence, and the build is deterministic so a
  rebuild produces no spurious diff.

## Architecture

### Source: the wikitext already cached

`.cache/` holds `prop=revisions` wikitext for all 6,482 root works — 48.8MB,
fetched during enrichment. **No network is required for root works.** That is
worth stating precisely, because the previous plan claimed the cache could serve
`action=parse` and it cannot: different URL, different cache key, zero hits.
Here the cache genuinely is the input, because wikitext is what it holds.

Chapter subpages (9,408) are **not** cached. Their handling is the one open
decision in this phase — see Implementation Step 1.

### Size

An EPUB is a zip. Measured on this corpus, HTML compresses at 0.148:

| | |
|---|---|
| Corpus as raw HTML | 370.8 MB (measured across 45 stratified works + 25 subpages) |
| **As EPUBs** | **~55-74 MB** |
| Pages cap | 1 GB |

No embedded fonts. The original ws-export EPUBs were ~4.35MB each, of which
~7.7MB of 8.2MB uncompressed was four repeated FreeSerif faces — that is the
single biggest reason self-hosting looked impossible and is not.

### EPUB assembly

`fflate` is already vendored (`docs/vendor/fflate.js`) and already used in both
directions by `docs/offline.mjs`, so the zip machinery exists. A minimal valid
EPUB needs:

```
mimetype                 <- MUST be first entry and STORED (level 0), per OCF
META-INF/container.xml
OPS/content.opf          <- metadata: title, author, language, source, licence
OPS/nav.xhtml
OPS/title.xhtml          <- attribution + licence, generated per work
OPS/text.xhtml           <- the work
```

The `mimetype` rule is the one detail that silently breaks readers. The existing
offline repack already asserts it; reuse that assertion rather than rewriting it.

### Layout in the repo

`docs/epub/<shard>/<ordinal>.epub`, sharded by ordinal prefix so no directory
holds 6,482 entries. Filenames use the ordinal rather than the title: Vietnamese
titles contain characters that are awkward across filesystems, and the ordinal
is already the site's key.

**Ordinals are positional and shift on re-ingest.** That is a known defect
inherited from `build-index.mjs` (`_ord = i`). Phase 1 does not fix it, but it
must not make it worse: the build writes a manifest mapping stable `id` to file
path, and the site resolves through the manifest rather than computing a path
from an ordinal.

## Related Code Files

- Create: `scripts/build-epubs.mjs` — wikitext → XHTML → EPUB
- Create: `scripts/lib/wikitext-to-xhtml.mjs` — the converter
- Create: `scripts/lib/epub.mjs` — OCF assembly, shared with the browser path
- Create: `docs/epub/` (generated, committed)
- Create: `docs/data/epub-manifest.json` — stable id → file path
- Modify: `.gitignore` — must NOT ignore `docs/epub/*.epub`; the existing
  `*.epub` rule would silently exclude the entire deliverable
- Modify: `scripts/build-index.mjs` — emit the manifest

## Implementation Steps

1. **Decide chapter handling first.** 555 works have 9,408 subpages, and their
   root page is a table of contents. Options: (a) EPUB per root only, so long
   works ship as a contents list — cheap and wrong; (b) harvest the 9,408
   subpages while Wikisource is still reachable and build complete EPUBs. Cost
   for (b) is ~9,408 batched `prop=revisions` requests, which **can** be batched
   50 at a time, so ~190 requests, not the 9,408 the old plan implied. Take (b).
2. `wikitext-to-xhtml.mjs`: templates, refs, headings, links, `<poem>` blocks.
   Reuse the stripping already proven in `scripts/enrich.mjs`, which was tuned
   against this exact corpus and its poetry-heavy shape.
3. `epub.mjs`: assemble the container. Assert `mimetype` is entry zero and
   STORED before writing. Refuse to emit a file that fails the assertion.
4. Generate a title page per work carrying author, source URL, and licence.
5. Build the first **200** EPUBs only. Measure total size, per-file size, and
   git status timing. Stop and re-plan if the projection diverges from ~55-74MB.
6. Build the rest; write the manifest.
7. Open 5 generated EPUBs in at least two real readers.
8. Compare 20 against ws-export EPUBs saved before the bot-wall, for fidelity.
9. Commit. Verify Pages serves a file and the download works end to end.

## Success Criteria

- [ ] Chapter-handling decision recorded with its measured cost
- [ ] An EPUB exists for every work, reachable from Pages
- [ ] Every EPUB passes the OCF structural assertion at build time
- [ ] 5 files open in two real readers
- [ ] `docs/` under 150MB; no file over 100MB
- [ ] Attribution and licence present in every EPUB
- [ ] Manifest maps stable id, not raw ordinal
- [ ] `.gitignore` does not exclude `docs/epub/`
- [ ] Rebuild is byte-identical

## Risk Assessment

- **`.gitignore` silently drops the deliverable.** `*.epub` is currently ignored
  repo-wide — it was added deliberately to prevent a 28GB mistake. Signal: the
  build succeeds and `git status` shows nothing. Response: add the negation
  before generating anything, and assert file count in git after the first 200.
- **Conversion quality is worse than ws-export.** Signal: side-by-side
  comparison in step 8 reads badly. Response: fall back to a one-time
  `action=parse` harvest while Wikisource remains reachable — Anubis fronts
  ws-export, not the MediaWiki API, which is still open and served us 95
  requests today.
- **Size projection wrong again.** The 0.148 ratio is measured, but on JSON of
  HTML, not on EPUB zips. Signal: the 200-file checkpoint diverges. Response:
  the checkpoint exists precisely to catch it; stop there rather than
  discovering it at 6,482.
- **6,482 files degrade git.** Signal: slow clone or `git status`. Response:
  measure at 200; shard deeper or move to a release asset if needed.
