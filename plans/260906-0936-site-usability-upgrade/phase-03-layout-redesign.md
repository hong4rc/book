---
phase: 3
title: "Layout Redesign"
status: pending
priority: P1
effort: "8h"
dependencies: [1]
---

# Phase 3: Layout Redesign

## Overview

Replace the flat text list with an editorial card grid, and give every book a
cover — generated, because real ones do not exist. Design direction produced via
`ak:ui-ux-pro-max` and then corrected against Vietnamese-specific constraints.

## Requirements

- Functional: card grid results; a cover for every book; a detail panel that
  reads as a book page rather than a field dump.
- Non-functional: WCAG AA (4.5:1 body, 3:1 large); 44px touch targets; usable at
  360px; light and dark; `prefers-reduced-motion` honoured; initial load stays
  under 500KB gzipped.

## Architecture

### Direction: Swiss Modernism / editorial

`ak:ui-ux-pro-max --design-system` returned **Swiss Modernism 2.0** — grid
system, modular scale, mathematical spacing, rated WCAG AAA and excellent for
performance. That suits a literature catalogue.

Its *pattern* recommendation was "Newsletter / Content First" with a hero email
form. **Rejected**: that is a landing-page conversion pattern, and this is a
6,482-item catalogue with no signup. The style transfers; the pattern does not.

### Typography: verified against Vietnamese, not assumed

The skill proposed Cormorant Garamond + Crimson Pro + **Cinzel**. Checked each
against the Google Fonts API:

| Font | Vietnamese subset | Verdict |
|---|---|---|
| Cormorant Garamond | yes | Display |
| Crimson Pro | yes | Optional body |
| Lora | yes (5.2KB subset) | Display alternative |
| Be Vietnam Pro | yes (11.5KB subset) | Body alternative |
| **Cinzel** | **NO** | **Rejected** |

**Cinzel has no Vietnamese subset.** Every accented title would fall back
mid-heading, producing mixed rendering on the majority of the catalogue. This is
the single most important constraint on this project's typography and it is
invisible unless checked.

Budget: a family's Vietnamese subset is small (5-12KB) because it covers only
the Vietnamese-specific range; the base Latin subset loads alongside it. Two
families at two weights is roughly 60-100KB, affordable against the current
172KB total. **Load only what is used**, with `font-display: swap` and a real
system-serif fallback stack so text is never invisible.

### Generated covers

Measured coverage of real images is **0.3%**, so covers are generated, not
fetched:

- Inline SVG, built at render time from title + author + category.
- Background hue derived from the category; a deterministic hash of the title
  varies tone within a category so a shelf does not look uniform.
- Title set in the display serif, truncated by line count, with the author
  beneath — the cover *is* typography, which is honest about what it is rather
  than imitating a photographic jacket.
- Zero bytes on the wire and zero repo growth: no image files, no requests.
- The rare real thumbnail (Wikidata / PageImages) replaces the generated one
  when present, so the good case is not thrown away.

### Layout

- Results become a responsive grid: 1 column at 360px, 2 at ~600px, 3-4 at
  desktop, via `repeat(auto-fill, minmax(…))` — no breakpoint list to maintain.
- A card carries cover, title, author, category chip, and chapter count.
- A **density toggle** (grid / compact list) is retained, because scanning 6,482
  items by title is a legitimate mode that covers hurt rather than help.
- The detail panel gets a two-column layout above ~700px: cover left, metadata
  and actions right; single column below.

### Accessibility, non-negotiable

Applying the skill's CRITICAL tier: body contrast ≥4.5:1 in **both** themes
(verified per theme, not inferred from light); visible focus rings; hit targets
≥44px; the whole card is one focusable link rather than a grid of tiny targets;
`prefers-reduced-motion` disables the hover lift; icons are SVG, never emoji.

## Related Code Files

- Create: `docs/cover.mjs` — deterministic SVG cover generator
- Modify: `docs/app.mjs` — card rendering, density toggle
- Modify: `docs/book.mjs` — two-column detail panel
- Modify: `docs/style.css` — grid, cards, type scale, tokens
- Modify: `docs/index.html` — font loading, density control
- Modify: `scripts/smoke-dom.mjs`

## Implementation Steps

1. Define tokens: type scale (12/14/16/18/24/32), 4/8px spacing rhythm, and
   semantic colour tokens per theme. No raw hex in components.
2. Add font loading for the two chosen families, Vietnamese + Latin subsets
   only, `font-display: swap`, with a system fallback stack.
3. Build `cover.mjs`: `coverSvg({title, author, category})` returning an inline
   SVG string. Deterministic — same book always yields the same cover.
4. Convert results to the auto-fill grid; make each card a single link.
5. Add the density toggle; persist the choice in `localStorage`.
6. Rebuild the detail panel as two columns above 700px, one below.
7. Verify contrast in both themes with a checker; fix any pair under 4.5:1.
8. Test at 360px, 768px, 1024px, and in landscape.
9. Extend the DOM test: assert a cover renders per card and the grid is present.

## Success Criteria

- [ ] Every result and detail view shows a cover
- [ ] No Vietnamese text renders in a fallback font mid-heading
- [ ] Body contrast ≥4.5:1 verified separately in light and dark
- [ ] No horizontal scroll at 360px
- [ ] All interactive targets ≥44px
- [ ] Cards keyboard-focusable with a visible ring; order matches visual order
- [ ] Hover motion disabled under `prefers-reduced-motion`
- [ ] Initial load still under 500KB gzipped

## Risk Assessment

- **Fonts push past the size budget.** Signal: gzipped initial load over 500KB.
  Response: drop to one custom family for display only and keep the system stack
  for body — the display face carries the editorial character.
- **Generated covers read as placeholders.** Signal: they look like missing
  images rather than design. Response: commit to typography as the design
  (large title, generous margin, category colour) instead of imitating a jacket;
  review a contact sheet of ~30 before wiring.
- **Grid hurts scanning.** A card grid is worse than a list for finding a known
  title. Signal: browsing 6,482 items feels slower than before. Response: the
  density toggle already exists for this; if the compact list wins in practice,
  make it the default.
- **Contrast regressions in dark mode.** Signal: a token pair under 4.5:1.
  Response: define dark tokens independently rather than inverting light ones.
