#!/usr/bin/env node
/**
 * Build the static site payload from data/books.ndjson.
 *
 * Emits:
 *   site/data/index.json      compact search index, loaded once
 *   site/data/shards/NN.json  full detail, fetched only when a book is opened
 *   site/data/facets.json     taxonomy for the filter sidebar
 *
 * Design note: this deliberately does NOT use a search engine library. With
 * ~7k records searching only title and author, the whole index is a few
 * hundred KB and a linear scan per keystroke is sub-millisecond. Pagefind's
 * chunked index and WASM runtime solve a problem this corpus does not have,
 * and skipping it leaves the site with zero runtime dependencies.
 */
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fold } from '../site/fold.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BOOKS = resolve(root, 'data/books.ndjson')
const FACETS = resolve(root, 'data/facets.json')
const OUT = resolve(root, 'site/data')
const SHARD_SIZE = 200
const RELATED_COUNT = 8

const records = (await readFile(BOOKS, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
console.log(`read ${records.length} records`)

// Ordinal position is the site-facing id, which keeps the index compact: a
// result carries an integer rather than repeating a long Vietnamese title.
records.forEach((r, i) => { r._ord = i })

const categoryNames = [...new Set(records.flatMap((r) => r.categories ?? []))].sort()
const categoryIndex = new Map(categoryNames.map((c, i) => [c, i]))

/**
 * Related works, precomputed so the browser does no corpus-wide work.
 *
 * Author match outweighs category overlap because "more by this author" is the
 * stronger signal for a reader. The null-author guard is essential: without it
 * every unknown-author work would score as related to every other one.
 */
function computeRelated() {
  const byCategory = new Map()
  const byAuthor = new Map()

  for (const r of records) {
    for (const c of r.categories ?? []) {
      if (!byCategory.has(c)) byCategory.set(c, [])
      byCategory.get(c).push(r._ord)
    }
    if (r.author) {
      if (!byAuthor.has(r.author)) byAuthor.set(r.author, [])
      byAuthor.get(r.author).push(r._ord)
    }
  }

  // A category holding a large share of the corpus carries almost no signal,
  // so it is skipped rather than allowed to relate everything to everything.
  const tooBroad = new Set(
    [...byCategory.entries()]
      .filter(([, list]) => list.length > records.length * 0.25)
      .map(([name]) => name),
  )

  for (const r of records) {
    const scores = new Map()
    const add = (ord, points) => {
      if (ord !== r._ord) scores.set(ord, (scores.get(ord) ?? 0) + points)
    }

    for (const c of r.categories ?? []) {
      if (tooBroad.has(c)) continue
      for (const ord of byCategory.get(c) ?? []) add(ord, 2)
    }
    if (r.author) for (const ord of byAuthor.get(r.author) ?? []) add(ord, 3)

    r._related = [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, RELATED_COUNT)
      .map(([ord]) => ord)
  }
}

computeRelated()

// Compact index: [title, author, foldedSearchText, [categoryIds]]
const index = {
  generated: new Date().toISOString().slice(0, 10),
  total: records.length,
  // Published rather than duplicated as a constant in the site code, so the
  // shard layout has exactly one source of truth.
  shardSize: SHARD_SIZE,
  categories: categoryNames,
  books: records.map((r) => [
    r.title,
    r.author,
    fold(`${r.title} ${r.author ?? ''}`),
    (r.categories ?? []).map((c) => categoryIndex.get(c)),
  ]),
}

await rm(OUT, { recursive: true, force: true })
await mkdir(resolve(OUT, 'shards'), { recursive: true })
await writeFile(resolve(OUT, 'index.json'), JSON.stringify(index), 'utf8')

let shardCount = 0
for (let start = 0; start < records.length; start += SHARD_SIZE) {
  const shard = {}
  for (const r of records.slice(start, start + SHARD_SIZE)) {
    shard[r._ord] = {
      title: r.title,
      author: r.author,
      sourceUrl: r.sourceUrl,
      downloads: r.downloads,
      categories: r.categories ?? [],
      chapters: r.chapters,
      quality: r.quality,
      license: r.license,
      isVersionsPage: r.extra?.isVersionsPage ?? false,
      related: r._related ?? [],
    }
  }
  await writeFile(
    resolve(OUT, 'shards', `${start / SHARD_SIZE}.json`),
    JSON.stringify(shard),
    'utf8',
  )
  shardCount++
}

try {
  await cp(FACETS, resolve(OUT, 'facets.json'))
} catch {
  console.warn('warning: data/facets.json missing; run derive-facets.mjs first')
}

// Vendor fflate's browser build so the site has no external runtime fetch.
try {
  await mkdir(resolve(root, 'site/vendor'), { recursive: true })
  await cp(
    resolve(root, 'node_modules/fflate/umd/index.js'),
    resolve(root, 'site/vendor/fflate.js'),
  )
} catch (err) {
  console.warn(`warning: could not vendor fflate (${err.code}); offline font-stripping will be disabled`)
}

const indexBytes = JSON.stringify(index).length
console.log(`index.json : ${(indexBytes / 1024).toFixed(0)}KB, ${records.length} books`)
console.log(`shards     : ${shardCount} files of up to ${SHARD_SIZE}`)
console.log(`categories : ${categoryNames.length}`)
console.log(`shard size : ${SHARD_SIZE}, related per book: ${RELATED_COUNT}`)
