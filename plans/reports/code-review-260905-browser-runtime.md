# Browser runtime review — 2026-09-05

Adversarial review of `docs/*.mjs` and the page markup, none of which had ever
been executed in a browser. Verdict: **the published site was non-functional
from first paint.** All findings below are now fixed and verified.

## Root cause

Every module had passing Node-level tests. None of them could catch a missing
element id, a boot-time exception, a CSS cascade defect, or a storage API that
is present but unusable. There was no test that loaded the page.

`npm run serve` also pointed at `site/`, a directory renamed to `docs/` earlier
the same day — so the one command that would have surfaced this locally was
itself broken. That is the whole story in one line.

## Critical

| # | Defect | Symptom | Fix |
|---|---|---|---|
| C1 | `.overlay{display:grid}` outranks the UA `[hidden]{display:none}` by origin | A fixed, full-viewport, `z-index:10` blurred layer sat over the page permanently and swallowed **every** click. `closeBook()` was a no-op. Site 100% unusable. | Explicit `.overlay[hidden]{display:none}` ahead of the display rule |
| C2 | `refreshOfflineCount()` awaited `offline.all()` unguarded at startup | `indexedDB` can be *defined yet unusable* (private windows, partitioned storage, `SecurityError`). One rejection aborted `main()` before the initial `route()`; facets rendered, then nothing. Silent. | try/catch at the boundary, `main().catch`, and `dbPromise` no longer caches a rejection |
| C3 | `offlineControls()` awaited `offline.get()` unguarded, inline in `renderDetail`'s append list | Same rejection replaced the whole book panel — title, metadata, **and the download links** — with a bare error string | Contained in try/catch; `refreshOfflineCount()` moved out of the render `try` |
| C4 | Bookmark button constructed, wired, never appended | Bookmarking silently impossible | Appended in an `.actions` row |

C4 was found while fixing C1–C3, not by the review.

## High

- **Poisoned shard cache** — the rejected promise was cached, so one flaky
  request permanently broke 200 books for the session, retries failing with no
  network call. Now evicted on failure.
- **Open race** — `openBook` had no request token; a slow shard resolving late
  overwrote a newer panel, showing the wrong book's downloads. Token added.
- **Deep links broken** — `readHash()` returned early on a `book/` route without
  setting state, so a shared `#book/N` link rendered an overlay over an empty
  catalogue, and closing called `history.back()` and left the site. Now state is
  always parsed, the list renders first, and close falls back to `replaceState`
  when there is no in-app history.
- **Unvalidated bookmark import** — arbitrary JSON was written to localStorage,
  then crashed `resultRow` on every later render, unrecoverable through the UI.
  Now validated on import and defended in the renderer.
- **Search cost** — two full scans per keystroke plus `fold()` per candidate.
  Worst case was the **first character typed** (matches nearly everything, typed
  fastest): 45ms desktop, 200ms+ mobile. Now single-pass with the folded title
  precomputed at build time: **3.8ms**.

## Medium and low

Facet checkboxes desynced on back/forward; bookmark Export/Import were hidden in
the Bookmarks view; no focus restore or background `inert` despite
`aria-modal="true"`; Import was mouse-only; offline count went stale after
save/remove; `zipSync` froze the tab on an 8MB EPUB; `revokeObjectURL` fired too
early; view buttons ran the route twice; `#book/` opened book 0. All fixed.

## Verified correct — no change needed

- **EPUB repack.** Checked at byte level: `mimetype` is entry zero, method 0
  (STORED), no extra field. `{level: 0}` is the shape fflate expects, and object
  key insertion order holds. The one real issue was that it ran synchronously,
  now async.
- **Script ordering.** `<script defer>` and `<script type="module">` both run
  after parsing, in document order, so `globalThis.fflate` is guaranteed present.
- **No DOM XSS.** Everything goes through `textContent`; no `innerHTML`.
- **`fold.mjs`.** Correct, including the `đ`/`Đ` mapping NFD misses.

## Prevention

`scripts/smoke-dom.mjs` boots the real page in jsdom and asserts it renders,
searches, deep-links, and survives having no IndexedDB — jsdom provides no
`indexedDB`, which makes the degradation path free to test. 26 checks, including
a text assertion guarding the C1 cascade defect that jsdom cannot model. Wired
into `npm test` and CI.

`scripts/smoke-search.mjs` now imports the shipping `docs/search.mjs` instead of
duplicating its scoring; the previous copy could agree with itself while
disagreeing with the site.

## Open questions

- The repack is verified structurally but still unopened by a real e-reader.
- No real-browser check yet (jsdom is not a browser); Safari IndexedDB eviction
  behaviour in particular is untested.
