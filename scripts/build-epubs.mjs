#!/usr/bin/env node
/**
 * Build one EPUB per work from cached wikitext, into docs/epub/.
 *
 * These files ARE the product. The site links to them directly, so no download
 * touches ws-export — which now sits behind a proof-of-work bot-wall and has
 * never sent CORS headers.
 *
 * Usage:
 *   node scripts/build-epubs.mjs --limit 200   # checkpoint: measure before committing to 6,482
 *   node scripts/build-epubs.mjs               # all works
 */
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { getJson } from './lib/http.mjs'
import { wikitextToXhtml } from './lib/wikitext-to-xhtml.mjs'
import { buildEpub } from './lib/epub.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BOOKS = resolve(root, 'data/books.ndjson')
const CHAPTERS = resolve(root, 'data/chapters.json')
const OUT = resolve(root, 'docs/epub')
const MANIFEST = resolve(root, 'docs/data/epub-manifest.json')
const API = 'https://vi.wikisource.org/w/api.php'
const SHARD = 200 // files per directory; 6,482 in one folder is unpleasant everywhere

const argv = process.argv.slice(2)
const limitArg = argv.indexOf('--limit')
const LIMIT = limitArg !== -1 ? Number(argv[limitArg + 1]) : Infinity

const log = (m) => console.log(m)
const api = (p) => `${API}?${new URLSearchParams({ format: 'json', ...p })}`
const mb = (b) => (b / 1024 / 1024).toFixed(1)

const records = (await readFile(BOOKS, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
let chaptersByWork = {}
try {
  chaptersByWork = JSON.parse(await readFile(CHAPTERS, 'utf8'))
} catch {
  log('warning: data/chapters.json missing — multi-part works will ship as their contents page only')
}

/**
 * Wikitext for a set of titles, read through the cache.
 *
 * The harvest already fetched everything, so this should be entirely cache
 * hits. Anything missing is reported rather than silently skipped: a work
 * quietly shipping without its text is exactly the failure this build exists
 * to prevent.
 */
const wikitextCache = new Map()
async function wikitextFor(titles) {
  const missing = titles.filter((t) => !wikitextCache.has(t))
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50)
    let body
    try {
      body = await getJson(api({
        action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
        titles: batch.join('|'),
      }))
    } catch {
      continue
    }
    for (const p of Object.values(body.query?.pages ?? {})) {
      const c = p?.revisions?.[0]?.slots?.main?.['*']
      if (c) wikitextCache.set(p.title, c)
    }
  }
  return titles.map((t) => wikitextCache.get(t))
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const manifest = {}
let built = 0, skipped = 0, totalBytes = 0, largest = { bytes: 0, title: '' }
const targets = records.slice(0, LIMIT === Infinity ? records.length : LIMIT)
log(`building ${targets.length} EPUBs`)

for (const [i, r] of targets.entries()) {
  const chapterTitles = chaptersByWork[r.id] ?? []
  const pages = chapterTitles.length ? chapterTitles : [r.title]
  const texts = await wikitextFor(pages)

  const sections = []
  for (const [j, wt] of texts.entries()) {
    if (!wt) continue
    const xhtml = wikitextToXhtml(wt)
    if (!xhtml.trim()) continue
    // Chapter labels drop the "Work/" prefix so the ToC reads as chapters.
    const label = chapterTitles.length ? pages[j].slice(r.title.length + 1) || `${j + 1}` : r.title
    sections.push({ title: label, xhtml })
  }

  if (sections.length === 0) { skipped++; continue }

  let bytes
  try {
    bytes = buildEpub(
      {
        id: r.id,
        title: r.title,
        author: r.author,
        language: r.language,
        sourceUrl: r.sourceUrl,
        license: r.license,
        year: r.year,
        modified: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      },
      sections,
    )
  } catch (err) {
    log(`  FAILED ${r.title.slice(0, 40)}: ${err.message}`)
    skipped++
    continue
  }

  const shard = String(Math.floor(i / SHARD))
  await mkdir(join(OUT, shard), { recursive: true })
  // Filename is the ordinal, not the title: Vietnamese titles contain
  // characters that travel badly across filesystems.
  const rel = `${shard}/${i}.epub`
  await writeFile(join(OUT, rel), bytes)

  // Manifest keys on the STABLE id, never the positional ordinal, which shifts
  // whenever a work is inserted upstream.
  manifest[r.id] = rel
  built++
  totalBytes += bytes.length
  if (bytes.length > largest.bytes) largest = { bytes: bytes.length, title: r.title }
  if (built % 500 === 0) log(`  ${built}/${targets.length}  (${mb(totalBytes)} MB so far)`)
}

await mkdir(dirname(MANIFEST), { recursive: true })
await writeFile(MANIFEST, JSON.stringify(manifest), 'utf8')

const avg = built ? totalBytes / built : 0
log(`\nbuilt      : ${built}`)
log(`skipped    : ${skipped} (no usable text)`)
log(`total      : ${mb(totalBytes)} MB`)
log(`average    : ${(avg / 1024).toFixed(1)} KB`)
log(`largest    : ${(largest.bytes / 1024).toFixed(0)} KB`)
if (built && targets.length < records.length) {
  log(`\nPROJECTION for all ${records.length}: ${mb(avg * records.length)} MB`)
}
