---
phase: 6
title: "Reader Features"
status: in-progress
priority: P2
effort: "6h"
dependencies: [4]
---

# Phase 6: Reader Features

## Overview

The features that make the catalogue usable as a personal library rather than a
lookup table: bookmarks, offline saving that does not waste gigabytes, and
related-book discovery. All still static, all still no backend.

## Requirements

- Functional: bookmark a work; save a work for offline reading; see related
  works on a detail page.
- Non-functional: offline storage must survive large corpora without exhausting
  disk; every feature degrades cleanly when storage is unavailable or denied.

## Architecture

### Storage is tiered, because the two jobs are not alike

| Data | Store | Size | Rationale |
|---|---|---|---|
| Bookmarks | `localStorage` | a few KB | Only ids plus title; sync API is a good fit for a tiny list |
| Offline EPUBs | **IndexedDB** | MB to GB | Holds `Blob` directly; `localStorage` caps near 5MB and stores strings only, so a single book would overflow it |

Putting an EPUB in `localStorage` would require base64, inflating it by a third
*and* still hitting the cap on the first book. IndexedDB is the only correct
choice for the binaries.

### Client-side font stripping: the 10x saving

Measured during planning: a Wikisource EPUB is ~4.35MB, of which ~7.7MB of
8.2MB uncompressed is four embedded FreeSerif fonts. The text is ~370KB.

**The exporter offers no way to skip them.** `&fonts=` was tested against both
`format=epub` and `format=epub-3` and returned a byte-identical 4,455,931-byte
file with the fonts still present. So stripping must happen in the browser.

An EPUB is a ZIP. On "save offline":

1. Fetch the EPUB as a `Blob`.
2. Unzip with [`fflate`](https://github.com/101arrowz/fflate) (~8KB gzipped).
3. Drop `OPS/fonts/*`; strip the matching `@font-face` blocks from `OPS/main.css`.
4. Re-zip, storing `mimetype` **first and uncompressed** — required by the EPUB
   spec, and the one detail that silently breaks readers if missed.
5. Persist the result in IndexedDB.

Expected: **~4.35MB to ~420KB per work, roughly 10x.** The tradeoff is that the
saved copy relies on device fonts, which is safe — modern devices all render
Vietnamese natively. The **original download remains untouched and default**;
stripping applies only to the offline copy, and is a user-visible toggle rather
than a silent transformation.

Quota is requested honestly, never assumed:

```js
await navigator.storage.persist()            // ask; may be refused
const { usage, quota } = await navigator.storage.estimate()
```

`QuotaExceededError` is caught and surfaced as a real message with current
usage, not swallowed.

### Related books, precomputed

Similarity is computed at **build time**, not in the browser:

```
score(a, b) = 2 * |categories(a) ∩ categories(b)|
            + 3 * (author(a) === author(b) && author(a) !== null)
```

The top 8 ids per work are written into the record's shard, which the detail
view already fetches — so related books cost **zero extra requests** and no
client-side computation over the corpus.

Author match is weighted above category overlap because "more by this author"
is the stronger signal for a reader. The `author !== null` guard matters:
without it every unknown-author work would be "related" to every other, which
is the obvious failure mode of this scoring.

## Related Code Files

- Create: `docs/bookmarks.mjs` (localStorage, export/import as JSON)
- Create: `docs/offline.mjs` (IndexedDB, fflate repack, quota handling)
- Create: `docs/related.mjs` (render precomputed related list)
- Modify: `scripts/build-index.mjs` (emit `related` into each shard)
- Modify: `docs/book.mjs`, `docs/app.mjs` (wire the UI)

## Implementation Steps

1. `bookmarks.mjs`: add, remove, list, and an `isBookmarked` check. Store
   `{id, title, addedAt}`. Wrap every access in try/catch — private mode can
   throw on write.
2. A "Bookmarks" view filtering the catalogue to saved ids, plus JSON
   export/import so a list is portable between devices.
3. `offline.mjs`: open an IndexedDB store keyed by book id; implement
   `save(id)`, `get(id)`, `remove(id)`, `list()`, `usage()`.
4. Implement the repack per the steps above. **Assert `mimetype` is entry zero
   and stored uncompressed**, then verify a repacked file opens in a real
   reader before wiring the UI.
5. Show per-book saved size and total usage in a storage panel, with a "clear
   all offline books" control.
6. `build-index.mjs`: compute the similarity scores and write `related` ids into
   each shard.
7. `related.mjs`: render the list on the detail page, resolving titles from the
   already-loaded shard.
8. Degrade cleanly: if IndexedDB is unavailable, hide offline controls and keep
   direct download working. The site must remain fully usable with no storage.

## Success Criteria

- [ ] Bookmarks persist across reload and survive a rebuild of the site
- [ ] Bookmark export/import round-trips
- [ ] A saved offline book is under 600KB where the original is ~4.35MB
- [ ] A repacked EPUB opens correctly in at least two readers
- [ ] Quota exhaustion shows a real message, never a silent failure
- [ ] Related books appear with no additional network request
- [ ] Every feature degrades cleanly when storage is denied
- [ ] Storage panel reports accurate per-book and total usage

## Risk Assessment

- **Repacking corrupts the EPUB.** The likeliest bug in the phase; `mimetype`
  ordering and compression are easy to get wrong and fail silently. Signal: a
  repacked file rejected by a reader. Response: validate structure immediately
  after repack and fall back to storing the original unmodified rather than
  storing something broken.
- **Stripped fonts render badly on some device.** Signal: user reports of
  missing Vietnamese glyphs. Response: keep the toggle; storing the full
  original stays available per book.
- **Safari evicts IndexedDB** after inactivity. Signal: books vanish.
  Response: call `navigator.storage.persist()`, and state plainly in the UI that
  offline copies are a cache, not durable storage — overpromising here would be
  worse than the eviction.
- **Related lists are dull** when categories are broad. Signal: every work in a
  large facet relates to the same handful. Response: tune weights after Phase 3
  reports real category sizes; consider down-weighting very large categories.
