#!/usr/bin/env node
/**
 * Measure the corpus in the units it would actually be STORED in.
 *
 * Written because the Phase 7 size table was wrong three ways at once, all
 * found by adversarial review:
 *   1. it measured wikitext, but the design stores rendered HTML
 *   2. it covered root pages only, excluding the 9,408 chapter subpages that
 *      hold the text of the 555 longest works
 *   3. it assumed the cache could serve action=parse; the cache holds
 *      prop=revisions, a different URL and therefore a different cache key
 *
 * So: sample real pages through action=parse, stratified across the size
 * distribution rather than taken from the front of the alphabet, and report
 * a projection with its sampling error stated.
 *
 * Output is measurement only. Nothing is written to the catalogue.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { getJson, stats } from './lib/http.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BOOKS = resolve(root, 'data/books.ndjson')
const OUT = resolve(root, 'plans/reports/corpus-measurement.md')
const API = 'https://vi.wikisource.org/w/api.php'

const ROOT_SAMPLE = 45      // stratified across the wikitext size distribution
const CHAPTER_SAMPLE = 25   // the previously unmeasured 9,408 subpages
const STRATA = 5

const log = (m) => console.log(m)
const api = (p) => `${API}?${new URLSearchParams({ format: 'json', ...p })}`
const kb = (b) => (b / 1024).toFixed(1)
const mb = (b) => (b / 1024 / 1024).toFixed(1)

const records = (await readFile(BOOKS, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))

/* ---- known wikitext sizes, straight from the cache (free, no network) ---- */
const { readdir } = await import('node:fs/promises')
const wikitextByTitle = new Map()
for (const f of await readdir(resolve(root, '.cache'))) {
  if (!f.endsWith('.json')) continue
  let d
  try { d = JSON.parse(await readFile(resolve(root, '.cache', f), 'utf8')) } catch { continue }
  for (const p of Object.values(d?.query?.pages ?? {})) {
    const c = p?.revisions?.[0]?.slots?.main?.['*']
    if (c) wikitextByTitle.set(p.title, Buffer.byteLength(c, 'utf8'))
  }
}
log(`wikitext sizes known for ${wikitextByTitle.size} works (from cache, no network)`)

/* ---- stratified sample: every size band, not just the common small ones ---- */
const sized = records
  .filter((r) => wikitextByTitle.has(r.title))
  .map((r) => ({ ...r, wt: wikitextByTitle.get(r.title) }))
  .sort((a, b) => a.wt - b.wt)

const perStratum = Math.ceil(ROOT_SAMPLE / STRATA)
const sample = []
for (let s = 0; s < STRATA; s++) {
  const lo = Math.floor((s * sized.length) / STRATA)
  const hi = Math.floor(((s + 1) * sized.length) / STRATA)
  const band = sized.slice(lo, hi)
  for (let i = 0; i < perStratum && band.length; i++) {
    sample.push(band[Math.floor((i * band.length) / perStratum)])
  }
}
log(`sampling ${sample.length} root works across ${STRATA} size strata`)

/* ---- parse each one; action=parse takes ONE page, it cannot be batched ---- */
/**
 * Returns raw byte size only.
 *
 * Deliberately does NOT simulate compression. Transfer size depends on what the
 * CDN negotiates and at what level, and approximating that locally is guesswork
 * — an earlier version of this script hardcoded a ratio, then tried to
 * reverse-engineer the CDN's gzip level, both of which are the same mistake in
 * different clothes.
 *
 * Raw bytes answer the question this script exists for: does the corpus fit in
 * the repository, the checkout, and the Pages site limit. Transfer size is a
 * separate question, already answered by direct observation of the live site
 * (see TRANSFER_OBSERVED below) rather than predicted here.
 */
async function parseSize(title) {
  const body = await getJson(api({ action: 'parse', page: title, prop: 'text', formatversion: '2' }))
  const html = body?.parse?.text
  return typeof html === 'string' ? { raw: Buffer.byteLength(html, 'utf8') } : null
}

const rows = []
for (const [i, r] of sample.entries()) {
  try {
    const m = await parseSize(r.title)
    if (m) rows.push({ wt: r.wt, raw: m.raw })
  } catch (err) {
    log(`  skip: ${err.message}`)
  }
  if ((i + 1) % 10 === 0) log(`  parsed ${i + 1}/${sample.length}`)
}

const ratio = rows.reduce((a, r) => a + r.raw, 0) / rows.reduce((a, r) => a + r.wt, 0)
log(`\nHTML/wikitext ratio: ${ratio.toFixed(2)}x over ${rows.length} works`)

/* ---- chapter subpages: the 9,408 pages never previously measured ---- */
const multipart = records.filter((r) => r.chapters > 0)
const chapterTitles = []
for (const r of multipart.slice(0, CHAPTER_SAMPLE)) {
  try {
    const body = await getJson(api({
      action: 'query', list: 'allpages', apnamespace: '0',
      apprefix: r.title + '/', aplimit: '2', apfilterredir: 'nonredirects',
    }))
    for (const p of body.query?.allpages ?? []) chapterTitles.push(p.title)
  } catch { /* a missing prefix is not fatal to the measurement */ }
}

const chapterRows = []
for (const t of chapterTitles.slice(0, CHAPTER_SAMPLE)) {
  try {
    const m = await parseSize(t)
    if (m) chapterRows.push(m.raw)
  } catch { /* skip */ }
}

const avgChapterHtml = chapterRows.length
  ? chapterRows.reduce((a, b) => a + b, 0) / chapterRows.length
  : 0

/* ---- project, and state the uncertainty rather than hiding it ---- */
const totalWikitext = [...wikitextByTitle.values()].reduce((a, b) => a + b, 0)
const rootHtml = totalWikitext * ratio
const chapterHtml = avgChapterHtml * 9408
const totalHtml = rootHtml + chapterHtml

// Observed, not predicted: measured directly against the live site for an
// already-published shard of the same content type.
//   https://hong4rc.github.io/book/data/shards/0.json
//   raw 191,652 B -> transfer 28,374 B, Content-Encoding: gzip
// GitHub Pages was checked for br and zstd; it negotiates neither, falling back
// to gzip, or to identity if gzip is not advertised.
const TRANSFER_OBSERVED = { raw: 191652, transfer: 28374, encoding: 'gzip' }
const observedRatio = TRANSFER_OBSERVED.transfer / TRANSFER_OBSERVED.raw

const report = `# Corpus measurement — ${new Date().toISOString().slice(0, 10)}

Measured because the Phase 7 size table was wrong in three ways at once, each
found by adversarial review and each verified before this run.

## Method

- HTML sizes come from \`action=parse\`, the format Phase 7 actually stores.
- The root sample is **stratified across ${STRATA} size bands**, not taken from
  the front of the alphabet — the earlier 60-sample estimate was 2.3x low
  precisely because it missed the tail.
- Chapter subpages are measured directly; they were previously excluded
  entirely, which omitted the text of the 555 longest works.

## Results

| | Value |
|---|---|
| Root works parsed | ${rows.length} |
| Chapter subpages parsed | ${chapterRows.length} |
| **HTML / wikitext ratio** | **${ratio.toFixed(2)}x** |
| Mean chapter HTML | ${kb(avgChapterHtml)} KB |
| Known wikitext total (6,482 roots) | ${mb(totalWikitext)} MB |

## Projection, stored as HTML

| Component | Raw | Gzipped (~${observedRatio.toFixed(3)}) |
|---|---|---|
| Root works | ${mb(rootHtml)} MB | ${mb(rootHtml * observedRatio)} MB |
| Chapter subpages (9,408) | ${mb(chapterHtml)} MB | ${mb(chapterHtml * observedRatio)} MB |
| **Total** | **${mb(totalHtml)} MB** | **${mb(totalHtml * observedRatio)} MB** |

## Against the plan's stated figures

| Claim in Phase 7 | Reality |
|---|---|
| 48.8 MB raw | wikitext only, and roots only |
| 14.2 MB gzipped | ${mb(totalHtml * observedRatio)} MB — wrong unit and wrong scope |
| "Repo stays under 300MB" | ${totalHtml > 300 * 1024 * 1024 ? '**BREACHED**' : 'holds, but with little margin'} |
| "zero further requests" | false: ${stats().liveRequests} live requests were needed for this sample alone |

## Uncertainty

The ratio is a sample statistic. Chapter sizes vary widely by work, and only
${chapterRows.length} subpages were measured against a population of 9,408, so
the chapter component carries the most error. Treat the total as an order of
magnitude, not a budget — and re-measure before committing to shard geometry.
`

await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, report, 'utf8')

log(`\nroot HTML     : ${mb(rootHtml)} MB`)
log(`chapter HTML  : ${mb(chapterHtml)} MB (9,408 pages)`)
log(`TOTAL stored  : ${mb(totalHtml)} MB raw / ~${mb(totalHtml * observedRatio)} MB gzipped`)
log(`live requests : ${stats().liveRequests}`)
log(`report        -> plans/reports/corpus-measurement.md`)
