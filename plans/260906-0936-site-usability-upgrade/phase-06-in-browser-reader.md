---
phase: 6
title: "In Browser Reader"
status: pending
priority: P1
effort: "8h"
dependencies: [1]
---

# Phase 6: In Browser Reader

## Overview

Let people actually read a book on the site instead of only downloading it.
This is the largest usefulness gain available and, unusually, it needs no
backend — verified before planning.

## Requirements

- Functional: read any work in a reader panel; chapter navigation for the 555
  multi-part works; adjustable text size; resume where you left off.
- Non-functional: no backend; content sanitized before insertion; attribution and
  licence shown; works offline for books already saved.

## Architecture

### Feasibility, verified not assumed

```
GET /w/api.php?action=parse&page=<title>&prop=text&formatversion=2&origin=*
  -> HTTP 200
  -> access-control-allow-origin: *          <- cross-origin read is allowed
  -> 358KB rendered HTML for Truyện Kiều
  -> <script> present: False
  -> tags: a b br dd div dl figcaption figure i img li p span ul
```

Wikimedia serves the API cross-origin with `origin=*`, so the browser can fetch
a work directly from GitHub Pages. The returned HTML is structural text markup
only.

### Sanitize anyway

The probe found no `<script>`, but that is an observation about one page, not a
guarantee — and injecting remote HTML is the classic XSS vector. Sanitize with an
**allowlist**, never a blocklist:

- Allowed tags: the observed structural set (`p, div, span, a, b, i, br, ul, ol,
  li, dl, dd, dt, figure, figcaption, img, h1-h6, table, tr, td, th, sup, small`).
- Strip every `on*` attribute and any `href`/`src` whose scheme is not
  `https:` (kills `javascript:` and `data:`).
- Rewrite protocol-relative `//upload.wikimedia.org` to `https:`.
- Internal `/wiki/...` links: resolve to our own book page when the target is in
  the catalogue, otherwise send to Wikisource with `rel="noopener"`.

Build the DOM with `DOMParser` and walk it, rather than regex over a string —
regex sanitizers are a well-known source of bypasses.

### Licensing is a hard requirement, not a footnote

Displaying the text on our own site is exactly the case CC BY-SA covers. Every
reader view must show the work's licence, attribute Vietnamese Wikisource, and
link to the source page. 99.7% of the corpus is public domain, but the 0.3%
under CC BY-SA makes attribution non-optional, and it costs nothing to show it
for all of them.

### Chapters

555 works have subpages. The reader fetches the root, and for a multi-part work
builds a chapter list from `chapters` plus a `list=allpages` prefix query, each
chapter fetched on demand. Position persists per book in `localStorage`.

### Offline

A book saved offline already has its EPUB in IndexedDB. Reading offline should
unzip that stored EPUB and render its XHTML through the same sanitizer, rather
than a second copy of the text — reusing what is already there.

## Related Code Files

- Create: `docs/reader.mjs` — fetch, sanitize, render, chapter nav
- Create: `docs/sanitize.mjs` — allowlist DOM sanitizer (shared, testable)
- Modify: `docs/book.mjs` — "Đọc sách" action
- Modify: `docs/style.css` — reading typography (measure, line-height, sizes)
- Modify: `scripts/smoke-dom.mjs` — sanitizer assertions

## Implementation Steps

1. `sanitize.mjs`: `sanitizeHtml(string) -> DocumentFragment` via `DOMParser`,
   allowlisting tags/attributes and rewriting links as above.
2. Unit-test the sanitizer against hostile input: inline `<script>`,
   `onerror=`, `javascript:` href, `data:` src, nested/malformed markup.
   **Write these before the fetch path** — the sanitizer is the security
   boundary and deserves tests first.
3. `reader.mjs`: fetch via the parse API with `origin=*`, sanitize, render.
4. Reading layout: 60-75 character measure, 1.6-1.75 line-height, generous
   margins, A/A+ text-size control persisted in `localStorage`.
5. Chapter list for multi-part works; prev/next; remember last position.
6. Attribution block: licence, "Nguồn: Vietnamese Wikisource", source link.
7. Offline path: render from the stored EPUB when present, same sanitizer.
8. Loading and error states — a 358KB fetch is not instant on mobile.

## Success Criteria

- [ ] Any work opens and reads in the browser
- [ ] Sanitizer rejects script tags, `on*` handlers, and `javascript:`/`data:` URLs
- [ ] Sanitizer has hostile-input tests that fail loudly on regression
- [ ] Multi-part works expose chapter navigation
- [ ] Licence and Wikisource attribution shown in every reader view
- [ ] Text size control persists
- [ ] Reading position restored per book
- [ ] Offline-saved books readable with no network

## Risk Assessment

- **Sanitizer bypass.** The one genuinely dangerous part of this phase. Signal: a
  hostile-input test fails. Response: allowlist plus `DOMParser` traversal, never
  regex; tests written before the feature. If confidence is low, render inside a
  sandboxed iframe (`sandbox="allow-same-origin"`) and accept the styling cost.
- **Wikimedia rate limits from the browser.** Every reader is a client, so load
  scales with visitors rather than with us. Signal: 429s reported by users.
  Response: cache fetched chapters in `sessionStorage`; if it becomes a real
  problem, read from the stored EPUB instead of re-fetching.
- **Large works block the main thread.** 358KB of HTML to parse and sanitize.
  Signal: a visible freeze on open. Response: chunk the sanitize walk, show a
  skeleton, and prefer the chapter-at-a-time path for multi-part works.
- **CORS policy changes upstream.** Signal: reader fetches start failing.
  Response: the download path still works and is unaffected; the reader degrades
  to the existing EPUB/Wikisource links rather than breaking the page.
