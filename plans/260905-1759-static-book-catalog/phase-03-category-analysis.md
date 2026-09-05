---
phase: 3
title: "Category Analysis"
status: pending
priority: P1
effort: "5h"
dependencies: [2]
---

# Phase 3: Category Analysis

## Overview

Turn raw Wikisource category strings into a small, browsable taxonomy. This is
the "analyse the categories" half of the request, and it is mostly a filtering
problem: the raw category space is dominated by maintenance bookkeeping.

## Requirements

- Functional: emit `data/facets.json` holding a clean category tree with counts;
  write `categories` onto every record; produce a coverage report.
- Non-functional: the derivation is a pure function of `rawCategories`, so it
  re-runs offline with no API access.

## Architecture

**The core finding.** Sampling `list=allcategories` with `acmin=20` returned
mostly non-subject categories. Observed:

| Kind | Examples from the live sample | Action |
|---|---|---|
| Template/maintenance | `Bản mẫu Mục lục`, `Bản mẫu Wikisource`, `Bản mẫu giấy phép` | Drop |
| Proofread status | `100%`, `75%`, `50%`, `25%`, `Chưa hiệu đính` | Route to `quality`, not category |
| Housekeeping | `Bảo quản Wikisource`, `Bảo quản tác gia`, `Có vấn đề` | Drop |
| Licence | `Creative Commons BY-SA` | Route to `license`, not category |
| **Real subject** | `Ca dao Việt Nam`, `Cổ tích`, `Cổ tích Việt Nam`, `Bộ luật Việt Nam`, `Diễn văn`, `Bài báo` | **Keep** |

Roughly two-thirds of high-frequency categories are noise. Presenting them raw
would bury genuine subjects like folk poetry and folk tales under template
bookkeeping.

**Three-stage derivation:**

1. **Reject** — drop any category matching a maintenance prefix
   (`Bản mẫu`, `Bảo quản`, `Wikisource`, ...) or a status pattern
   (`^\d+%$`, `Chưa hiệu đính`, `Có vấn đề`).
2. **Route** — proofread and licence categories are moved to the `quality` and
   `license` fields rather than kept as subjects.
3. **Group** — map survivors onto a curated top-level tree. Sibling categories
   are merged: `Cổ tích` and `Cổ tích Việt Nam` are one facet to a reader.

Proposed top level, to be confirmed against real counts once Phase 2 has run:

```
Thơ ca         (poetry, ca dao, ngâm khúc)
Truyện         (fiction, cổ tích, truyện ngắn)
Lịch sử        (history, chronicles)
Pháp luật      (legal codes, decrees)
Tôn giáo       (religious and scriptural texts)
Báo chí        (periodical articles)
Diễn văn       (speeches)
Khác           (everything uncategorised)
```

The mapping lives in a **hand-editable** `config/taxonomy.json`, not in code, so
the taxonomy can be tuned without touching the pipeline. `Khác` is deliberate:
an honest catch-all beats forcing a wrong parent onto an odd work.

## Related Code Files

- Create: `config/taxonomy.json` (reject rules + grouping map)
- Create: `scripts/derive-facets.mjs`
- Create: `plans/reports/category-coverage.md` (generated)
- Modify: `data/books.ndjson` (populate `categories`)
- Create: `data/facets.json`

## Implementation Steps

1. Tally every distinct string in `rawCategories` across the corpus with counts;
   dump the top 300 for inspection. **Design the taxonomy against real
   frequencies, not the sampled guess above.**
2. Encode reject patterns in `config/taxonomy.json`; verify the reject rate
   against the tally and confirm no high-frequency subject is caught by mistake.
3. Encode the grouping map from surviving categories to top-level facets.
4. `derive-facets.mjs`: apply reject, route, then group; write `categories` per
   record and `facets.json` with per-facet counts.
5. Generate the coverage report: percentage of works landing in a real facet vs
   `Khác`, and the 50 most common still-unmapped categories.
6. Iterate the map until `Khác` is under 25%.

## Success Criteria

- [ ] `facets.json` has 6-10 top-level facets with non-trivial counts
- [ ] Under 25% of works fall into `Khác`
- [ ] Zero maintenance/template categories surface as user-visible facets
- [ ] `quality` and `license` populated from routed categories, not subjects
- [ ] Derivation re-runs offline and is deterministic
- [ ] Coverage report committed

## Risk Assessment

- **Reject rules are too greedy.** A real subject starting with a rejected
  prefix disappears silently. Signal: a category in the top-300 tally that is
  rejected but reads as a genuine subject. Response: reject rules are exact
  patterns reviewed against the tally, never blind prefix guesses; the coverage
  report lists every rejected string with its count so over-rejection is visible
  rather than silent.
- **Vietnamese diacritics in matching.** Case and diacritic handling can break
  comparisons. Response: NFC-normalise before matching; never strip diacritics,
  since that merges genuinely distinct Vietnamese words.
- **Taxonomy is a judgement call.** There is no single correct grouping.
  Response: keep it in JSON, and keep `rawCategories` so it can be redone from
  scratch at any time. Surface the proposed tree to the operator before locking.
