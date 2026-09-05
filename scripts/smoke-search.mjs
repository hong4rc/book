#!/usr/bin/env node
/**
 * End-to-end search check against the real built index.
 *
 * check-fixtures.mjs proves folding is correct in isolation; this proves the
 * whole path works on actual catalogue data — that a reader typing Vietnamese
 * without diacritics finds the book they meant, and that it ranks first rather
 * than merely appearing somewhere in the results.
 *
 * This imports the SHIPPING docs/search.mjs rather than reimplementing its
 * scoring. An earlier version kept a parallel copy, which meant the test could
 * agree with itself while disagreeing with the site.
 *
 * Run after `npm run build`.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = resolve(root, 'docs/data/index.json')

// search.mjs loads its index through fetch(). Stub it to read from disk so the
// module under test runs exactly as it does in the browser.
globalThis.fetch = async (url) => {
  if (String(url).endsWith('index.json')) {
    return { ok: true, json: async () => JSON.parse(await readFile(indexPath, 'utf8')) }
  }
  return { ok: false, status: 404, json: async () => ({}) }
}

const { loadIndex, getIndex, search } = await import('../docs/search.mjs')
const index = await loadIndex()

let failures = 0
const titleOf = (ord) => getIndex().books[ord][0]

/** The accentless query must find the accented title, ranked first. */
const cases = [
  ['truyen kieu', 'Truyện Kiều'],
  ['Truyện Kiều', 'Truyện Kiều'],
  ['chinh phu ngam', 'Chinh phụ ngâm'],
  ['cung oan ngam khuc', 'Cung oán ngâm khúc'],
  ['binh ngo dai cao', 'Bình Ngô đại cáo'],
]

for (const [query, expected] of cases) {
  const { ordinals } = search(query, { limit: 20 })
  const titles = ordinals.map(titleOf)
  const position = titles.indexOf(expected)
  if (position === 0) {
    console.log(`OK   ${JSON.stringify(query).padEnd(22)} -> ${expected}`)
  } else if (position > 0) {
    console.error(`FAIL ${JSON.stringify(query)} found ${JSON.stringify(expected)} at rank ${position + 1}, expected 1`)
    console.error(`     top 3: ${titles.slice(0, 3).join(' | ')}`)
    failures++
  } else {
    console.error(`FAIL ${JSON.stringify(query)} did not find ${JSON.stringify(expected)}`)
    console.error(`     top 3: ${titles.slice(0, 3).join(' | ') || '(no results)'}`)
    failures++
  }
}

// A nonsense query must return nothing rather than everything.
if (search('zzzzqqqxx').total !== 0) {
  console.error('FAIL nonsense query returned results')
  failures++
}

// The uncapped total must exceed the capped page, and the cap must hold.
const broad = search('n', { limit: 100 })
if (broad.ordinals.length > 100) {
  console.error(`FAIL limit not honoured: ${broad.ordinals.length} results`)
  failures++
}
if (broad.total < broad.ordinals.length) {
  console.error(`FAIL total ${broad.total} below returned ${broad.ordinals.length}`)
  failures++
}

// Category filtering must narrow, never widen.
const unfiltered = search('', { limit: 1 }).total
const filtered = search('', { limit: 1, categories: new Set([0]) }).total
if (filtered > unfiltered) {
  console.error(`FAIL category filter widened results: ${filtered} > ${unfiltered}`)
  failures++
}

/* ------------------------------------------------------------- performance */
// The worst case is a ONE-character query: it matches nearly the whole corpus,
// and it is the moment the user is typing fastest.
const bench = (q, runs = 20) => {
  const started = performance.now()
  for (let i = 0; i < runs; i++) search(q, { limit: 100 })
  return (performance.now() - started) / runs
}

console.log('')
let worst = 0
for (const q of ['', 'n', 'ng', 'nguyen', 'truyen kieu']) {
  const ms = bench(q)
  worst = Math.max(worst, ms)
  console.log(`  ${JSON.stringify(q).padEnd(15)} ${ms.toFixed(1)}ms  (${search(q, { limit: 1 }).total} matches)`)
}
console.log(`\nworst-case query: ${worst.toFixed(1)}ms over ${index.total} books`)

// Desktop budget. A mid-range phone is roughly 4-6x slower, so keeping the
// desktop worst case here leaves mobile input responsive.
if (worst > 25) {
  console.error(`FAIL worst-case search ${worst.toFixed(1)}ms exceeds the 25ms budget`)
  failures++
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`)
  process.exit(1)
}
console.log('OK: all search smoke checks passed')
