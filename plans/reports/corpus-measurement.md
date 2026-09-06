# Corpus measurement — 2026-09-06

Measured because the Phase 7 size table was wrong in three ways at once, each
found by adversarial review and each verified before this run.

## Method

- HTML sizes come from `action=parse`, the format Phase 7 actually stores.
- The root sample is **stratified across 5 size bands**, not taken from
  the front of the alphabet — the earlier 60-sample estimate was 2.3x low
  precisely because it missed the tail.
- Chapter subpages are measured directly; they were previously excluded
  entirely, which omitted the text of the 555 longest works.

## Results

| | Value |
|---|---|
| Root works parsed | 45 |
| Chapter subpages parsed | 25 |
| **HTML / wikitext ratio** | **4.44x** |
| Mean chapter HTML | 16.8 KB |
| Known wikitext total (6,482 roots) | 48.8 MB |

## Projection, stored as HTML

| Component | Raw | Gzipped (~0.148) |
|---|---|---|
| Root works | 216.4 MB | 32.0 MB |
| Chapter subpages (9,408) | 154.4 MB | 22.9 MB |
| **Total** | **370.8 MB** | **54.9 MB** |

## Against the plan's stated figures

| Claim in Phase 7 | Reality |
|---|---|
| 48.8 MB raw | wikitext only, and roots only |
| 14.2 MB gzipped | 54.9 MB — wrong unit and wrong scope |
| "Repo stays under 300MB" | **BREACHED** |
| "zero further requests" | false: 0 live requests were needed for this sample alone |

## Uncertainty

The ratio is a sample statistic. Chapter sizes vary widely by work, and only
25 subpages were measured against a population of 9,408, so
the chapter component carries the most error. Treat the total as an order of
magnitude, not a budget — and re-measure before committing to shard geometry.
