---
phase: 1
title: "Fix Null Rendering"
status: completed
priority: P1
effort: "1h"
dependencies: []
---

# Phase 1: Fix Null Rendering

## Overview

Remove the stray `null` text appearing on nearly every book detail panel, and
close the test gap that let it ship.

## Requirements

- Functional: no literal `null` rendered anywhere in the UI.
- Non-functional: the fix must be structural — a future conditional child must
  not be able to reintroduce this.

## Architecture

`Node.append()` accepts nodes and strings, and **coerces anything else to a
string**. Passing `null` therefore appends a text node reading `null`. The
`el()` helper already filters falsy children, but `panel.append(...)` in
`renderDetail` calls `Node.append()` directly and bypasses that filter.

Two children can be `null`:

| Child | When null | Frequency |
|---|---|---|
| `book.isVersionsPage ? el(...) : null` | not a versions page | **6,474 / 6,482 works** |
| `relatedList(book, onOpen)` | book has no related works | occasional |

Reproduced:

```
x.append(<p>, null, <span>)  =>  "<p></p>null<span></span>"
```

**Fix: route every append through one filtering helper.** Rather than patching
the two call sites, export an `appendAll(parent, ...children)` that drops
nullish values, and use it wherever conditional children occur. Patching the
call sites alone leaves the same trap for the next conditional child.

## Related Code Files

- Modify: `docs/book.mjs` — `renderDetail`, add/export the shared helper
- Modify: `docs/app.mjs` — use the same helper for conditional appends
- Modify: `scripts/smoke-dom.mjs` — assert detail-panel contents

## Implementation Steps

1. Add `appendAll(parent, ...children)` beside `el()`, skipping `null` and
   `undefined` (keep `0` and `''` — they are legitimate content).
2. Replace the direct `panel.append(...)` in `renderDetail` with `appendAll`.
3. Audit both modules for any other direct `.append(` receiving a possibly-null
   expression; route those through the helper too.
4. Extend `smoke-dom.mjs`: open a book detail panel and assert
   `panel.textContent` does **not** match `/\bnull\b/`, and that it *does*
   contain the title and a download link.
5. Assert the same for a book with no related works, since that is the second
   null path.

## Success Criteria

- [ ] No detail panel renders `null`
- [ ] `smoke-dom.mjs` fails if a null child is reintroduced
- [ ] Assertion covers both a book with and without related works
- [ ] `npm test` green

## Risk Assessment

- **Over-filtering.** A helper dropping all falsy values would silently swallow
  a legitimate `0` or empty string. Signal: content disappears that should
  render. Response: filter on `== null` only, never generic falsiness — the
  existing `el()` uses truthiness and should be tightened to match.
- **Other bypasses remain.** Signal: `null` reappears somewhere else. Response:
  step 3's audit is a grep over `.append(`, not a guess; the DOM assertion in
  step 4 catches any survivor at the panel level regardless of source.
