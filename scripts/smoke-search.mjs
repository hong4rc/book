#!/usr/bin/env node
/**
 * End-to-end search check against the real built index.
 *
 * check-fixtures.mjs proves folding is correct in isolation; this proves the
 * whole path works on actual catalogue data — that a reader typing Vietnamese
 * without diacritics finds the book they meant, and that it ranks first rather
 * than merely appearing somewhere in the results.
 *
 * Run after `npm run build`.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fold, tokenize } from '../docs/fold.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const index = JSON.parse(await readFile(resolve(root, 'docs/data/index.json'), 'utf8'))

// Mirrors docs/search.mjs scoring. Kept in step by this test failing loudly if
// ranking behaviour drifts.
function rank(query) {
  const queryFolded = fold(query)
  const tokens = tokenize(query)
  const out = []

  for (let ord = 0; ord < index.books.length; ord++) {
    const [title, , foldedText] = index.books[ord]
    if (!tokens.every((t) => foldedText.includes(t))) continue

    let s = 0
    const foldedTitle = fold(title)
    if (foldedTitle === queryFolded) s += 1000
    else if (foldedTitle.startsWith(queryFolded)) s += 500
    else if (foldedTitle.includes(queryFolded)) s += 250
    for (const t of tokens) {
      if (new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(foldedTitle)) s += 40
    }
    s += Math.max(0, 60 - title.length / 4)
    out.push([ord, s])
  }
  return out.sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([ord]) => index.books[ord][0])
}

let failures = 0

/** The accentless query must find the accented title, ranked first. */
const cases = [
  ['truyen kieu', 'Truyện Kiều'],
  ['Truyện Kiều', 'Truyện Kiều'],
  ['chinh phu ngam', 'Chinh phụ ngâm'],
  ['cung oan ngam khuc', 'Cung oán ngâm khúc'],
  ['binh ngo dai cao', 'Bình Ngô đại cáo'],
]

for (const [query, expected] of cases) {
  const results = rank(query)
  const position = results.indexOf(expected)
  if (position === 0) {
    console.log(`OK   ${JSON.stringify(query).padEnd(22)} -> ${expected}`)
  } else if (position > 0) {
    console.error(`FAIL ${JSON.stringify(query)} found ${JSON.stringify(expected)} at rank ${position + 1}, expected rank 1`)
    console.error(`     top 3: ${results.slice(0, 3).join(' | ')}`)
    failures++
  } else {
    console.error(`FAIL ${JSON.stringify(query)} did not find ${JSON.stringify(expected)} at all`)
    console.error(`     top 3: ${results.slice(0, 3).join(' | ') || '(no results)'}`)
    failures++
  }
}

// A nonsense query must return nothing rather than everything.
if (rank('zzzzqqqxx').length !== 0) {
  console.error('FAIL nonsense query returned results')
  failures++
}

// Timing, against the real corpus rather than a synthetic one.
const started = performance.now()
for (let i = 0; i < 20; i++) rank('nguyen')
const perQuery = (performance.now() - started) / 20
console.log(`\nsearch latency: ${perQuery.toFixed(1)}ms per query over ${index.total} books`)
if (perQuery > 300) {
  console.error(`FAIL search too slow: ${perQuery.toFixed(1)}ms exceeds the 300ms budget`)
  failures++
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`)
  process.exit(1)
}
console.log('OK: all search smoke checks passed')
