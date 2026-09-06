#!/usr/bin/env node
/**
 * Third ingest pass: add the per-book context the detail panel lacks.
 *
 * Adds `year`, `excerpt`, `thumbnail`, and `description` to data/books.ndjson.
 *
 * What this deliberately does NOT add is a summary. Measured over 300 random
 * works, `prop=extracts` yielded 0% usable prose: TextExtracts returns an
 * article's lead paragraph, but a Wikisource page IS the work, so there is no
 * lead. Truyện Kiều returned empty; Sĩ returned "==== Chú thích ====".
 *
 * Instead we store the work's own opening lines, truncated, and the UI labels
 * them as an excerpt. Calling first lines a summary would misrepresent what the
 * reader is looking at.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { getJson, stats } from './lib/http.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BOOKS = resolve(root, 'data/books.ndjson')
const API = 'https://vi.wikisource.org/w/api.php'
const WIKIDATA = 'https://www.wikidata.org/w/api.php'
const EXCERPT_CHARS = 220
const TITLES_BUDGET = 1500 // same URI-length guard as the original ingest (HTTP 414)
const BATCH = 50

const log = (m) => console.log(m)
const api = (base, params) => `${base}?${new URLSearchParams({ format: 'json', ...params })}`

const records = (await readFile(BOOKS, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
log(`${records.length} records`)

/* ------------------------------------------------------------------- year */
// Free: publication-year categories are already on every record from the first
// ingest. They were rejected as taxonomy noise, but they are real metadata.
let withYear = 0
for (const r of records) {
  const hit = (r.rawCategories ?? [])
    .map((c) => /^Tác phẩm (\d{4})$/.exec(c))
    .find(Boolean)
  if (hit) {
    const y = Number(hit[1])
    // Guard against absurd values; the corpus also contains "Tác phẩm 759".
    if (y >= 1000 && y <= new Date().getFullYear()) { r.year = y; withYear++ }
  }
}
log(`year: ${withYear} (${((withYear / records.length) * 100).toFixed(1)}%) — no network used`)

/* ---------------------------------------------------------------- excerpt */

/** Reduce Wikisource wikitext to the opening prose of the work. */
function leadText(wikitext) {
  let t = wikitext
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\|[\s\S]*?\|\}/g, '')          // tables
    .replace(/\{\{[^{}]*\}\}/g, '')            // templates (one level)
    .replace(/\{\{[\s\S]*?\}\}/g, '')          // nested leftovers
    .replace(/^\s*[=]{2,}.*$/gm, '')           // headings
    .replace(/<\/?(poem|div|center|span|p|br|small|big)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1') // piped links -> label
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')                       // bold/italic
    .replace(/^[*#:;]+/gm, '')
    .replace(/&nbsp;/g, ' ')

  // Accumulate the opening lines rather than taking just one.
  //
  // Taking a single line failed for most of this corpus. Poetry is the largest
  // category here, and a line of Vietnamese verse is far shorter than a prose
  // opening — so a one-line excerpt kept falling under the minimum length and
  // being discarded. Measured: 25.9% coverage, with 2,640 of the 4,800 misses
  // in Thơ ca alone.
  //
  // Joining consecutive lines is also simply the right excerpt for a poem: the
  // opening couplet, not half of it.
  const lines = t
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && /\p{L}/u.test(l) && !/^[=|{[]/.test(l))

  if (lines.length === 0) return null
  let joined = ''
  for (const l of lines) {
    if (joined.length >= EXCERPT_CHARS) break
    // ' / ' is the conventional way to show a line break in quoted verse.
    joined += (joined ? ' / ' : '') + l
  }
  const clean = joined.replace(/\s+/g, ' ').trim()
  if (clean.length <= EXCERPT_CHARS) return clean
  const cut = clean.slice(0, EXCERPT_CHARS)
  return cut.slice(0, cut.lastIndexOf(' ')).trimEnd() + '…'
}

function batchTitles(titles) {
  const out = []
  let cur = [], len = 0
  for (const t of titles) {
    const cost = encodeURIComponent(t).length + 3
    if (cur.length && (cur.length >= BATCH || len + cost > TITLES_BUDGET)) { out.push(cur); cur = []; len = 0 }
    cur.push(t); len += cost
  }
  if (cur.length) out.push(cur)
  return out
}

const byTitle = new Map(records.map((r) => [r.title, r]))
const batches = batchTitles(records.map((r) => r.title))
log(`excerpt: ${batches.length} batches`)

let withExcerpt = 0, withThumb = 0
const wikidataIds = new Map()
let done = 0

for (const batch of batches) {
  const body = await getJson(
    api(API, {
      action: 'query',
      prop: 'revisions|pageimages|pageprops',
      rvprop: 'content',
      rvslots: 'main',
      piprop: 'thumbnail',
      pithumbsize: '400',
      titles: batch.join('|'),
    }),
  )

  for (const page of Object.values(body.query?.pages ?? {})) {
    const rec = byTitle.get(page.title)
    if (!rec) continue

    const content = page.revisions?.[0]?.slots?.main?.['*']
    if (content) {
      const ex = leadText(content)
      // Reject fragments: the "Sĩ" case proves a bare heading can survive.
      if (ex && ex.length >= 40) { rec.excerpt = ex; withExcerpt++ }
    }
    const thumb = page.thumbnail?.source
    if (thumb) { rec.thumbnail = thumb; withThumb++ }
    const qid = page.pageprops?.wikibase_item
    if (qid) wikidataIds.set(qid, rec)
  }

  done += batch.length
  if (done % 1000 < batch.length) log(`  ${done}/${records.length}`)
}

log(`excerpt: ${withExcerpt} (${((withExcerpt / records.length) * 100).toFixed(1)}%)`)
log(`thumbnail: ${withThumb} (${((withThumb / records.length) * 100).toFixed(1)}%)`)

/* ------------------------------------------------------------ description */
const qids = [...wikidataIds.keys()]
log(`wikidata: ${qids.length} items`)
let withDesc = 0

for (let i = 0; i < qids.length; i += BATCH) {
  const chunk = qids.slice(i, i + BATCH)
  const body = await getJson(
    api(WIKIDATA, { action: 'wbgetentities', props: 'descriptions', languages: 'vi|en', ids: chunk.join('|') }),
  )
  for (const [qid, entity] of Object.entries(body.entities ?? {})) {
    const rec = wikidataIds.get(qid)
    const d = entity.descriptions?.vi?.value ?? entity.descriptions?.en?.value
    if (rec && d) { rec.description = d; withDesc++ }
  }
}
log(`description: ${withDesc}`)

/* ------------------------------------------------------------------ write */
records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
await writeFile(BOOKS, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')

const { liveRequests, cacheHits } = stats()
log(`\nwrote ${records.length} records`)
log(`  live requests: ${liveRequests}, cache hits: ${cacheHits}`)
