#!/usr/bin/env node
/**
 * Fetch the wikitext of every chapter subpage into the request cache.
 *
 * 555 works are multi-part: their root page is a table of contents and the
 * actual text lives in 9,408 subpages. An earlier plan measured the corpus
 * without them, which excluded the content of the longest works entirely.
 *
 * Only chapter TITLES are written to data/; the wikitext stays in .cache/
 * (gitignored) because ~28MB of source material has no business in the repo
 * when the EPUBs built from it are the deliverable.
 *
 * Cost: ~555 prefix enumerations + ~189 batched content fetches. The MediaWiki
 * API batches `titles=` 50 at a time, so this is minutes, not hours. (ws-export
 * is the service behind a proof-of-work wall; the API itself is open.)
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { getJson, stats } from './lib/http.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BOOKS = resolve(root, 'data/books.ndjson')
const OUT = resolve(root, 'data/chapters.json')
const API = 'https://vi.wikisource.org/w/api.php'
const BATCH = 50
const TITLES_BUDGET = 1500 // URI-length guard; long titles caused HTTP 414 before

const log = (m) => console.log(m)
const api = (p) => `${API}?${new URLSearchParams({ format: 'json', ...p })}`

const records = (await readFile(BOOKS, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
const multipart = records.filter((r) => r.chapters > 0)
log(`${multipart.length} multi-part works, ${multipart.reduce((a, r) => a + r.chapters, 0)} subpages expected`)

/* ---- pass 1: enumerate each work's subpages, in order ---- */
const chaptersByWork = {}
let enumerated = 0

for (const [i, work] of multipart.entries()) {
  const titles = []
  let cont
  do {
    const body = await getJson(
      api({
        action: 'query',
        list: 'allpages',
        apnamespace: '0',
        apprefix: `${work.title}/`,
        aplimit: '500',
        apfilterredir: 'nonredirects',
        ...(cont ? { apcontinue: cont } : {}),
      }),
    )
    for (const p of body.query?.allpages ?? []) titles.push(p.title)
    cont = body.continue?.apcontinue
  } while (cont)

  // MediaWiki returns these in code-point order, which for "Work/1", "Work/2",
  // ... "Work/10" puts 10 before 2. Sort numerically where a trailing number
  // exists so chapters land in reading order inside the EPUB.
  titles.sort((a, b) => {
    const na = /\/(\d+)\s*$/.exec(a)
    const nb = /\/(\d+)\s*$/.exec(b)
    if (na && nb) return Number(na[1]) - Number(nb[1])
    return a.localeCompare(b, 'vi')
  })

  if (titles.length) chaptersByWork[work.id] = titles
  enumerated += titles.length
  if ((i + 1) % 100 === 0) log(`  enumerated ${i + 1}/${multipart.length} works, ${enumerated} subpages`)
}

log(`enumerated ${enumerated} subpages across ${Object.keys(chaptersByWork).length} works`)

/* ---- pass 2: pull wikitext into the cache, batched ---- */
const allTitles = Object.values(chaptersByWork).flat()
const batches = []
let cur = [], len = 0
for (const t of allTitles) {
  const cost = encodeURIComponent(t).length + 3
  if (cur.length && (cur.length >= BATCH || len + cost > TITLES_BUDGET)) { batches.push(cur); cur = []; len = 0 }
  cur.push(t); len += cost
}
if (cur.length) batches.push(cur)

log(`fetching wikitext in ${batches.length} batches`)
let done = 0
for (const batch of batches) {
  await getJson(api({
    action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
    titles: batch.join('|'),
  }))
  done += batch.length
  if (done % 2000 < batch.length) log(`  ${done}/${allTitles.length}`)
}

await writeFile(OUT, JSON.stringify(chaptersByWork, null, 0) + '\n', 'utf8')

const { liveRequests, cacheHits } = stats()
log(`\nwrote ${OUT.split(/[\\/]/).pop()}: ${Object.keys(chaptersByWork).length} works, ${allTitles.length} chapters`)
log(`  live requests: ${liveRequests}, cache hits: ${cacheHits}`)
