#!/usr/bin/env node
/**
 * Derive the browsable category taxonomy from raw Wikisource categories.
 *
 * Pure function of data/books.ndjson plus config/taxonomy.json — no network.
 * Rewrites `categories` on every record and writes data/facets.json.
 *
 * The problem this solves is mostly filtering: sampling the live category list
 * showed most high-frequency categories are template/maintenance bookkeeping
 * ("Bản mẫu ...", "Bảo quản ..."), proofread levels ("100%", "75%") or licence
 * tags — none of which are subjects a reader would browse by.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BOOKS = resolve(root, 'data/books.ndjson')
const CONFIG = resolve(root, 'config/taxonomy.json')
const FACETS = resolve(root, 'data/facets.json')
const REPORT = resolve(root, 'plans/reports/category-coverage.md')

const cfg = JSON.parse(await readFile(CONFIG, 'utf8'))
const records = (await readFile(BOOKS, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))

// NFC-normalise before any comparison. Diacritics are never stripped here:
// stripping them merges genuinely distinct Vietnamese words.
const norm = (s) => s.normalize('NFC').trim()
const lower = (s) => norm(s).toLowerCase()

const rejectPatterns = cfg.reject.patterns.map((p) => new RegExp(p))
const rejectExact = new Set(cfg.reject.exact.map(norm))

function isRejected(category) {
  const c = norm(category)
  if (rejectExact.has(c)) return true
  if (cfg.reject.prefixes.some((p) => c.startsWith(norm(p)))) return true
  return rejectPatterns.some((re) => re.test(c))
}

/** First group whose terms appear in the category name wins. */
function groupOf(category) {
  const c = lower(category)
  for (const [group, terms] of Object.entries(cfg.groups)) {
    if (group === '$comment') continue
    if (terms.some((t) => c.includes(lower(t)))) return group
  }
  return null
}

const rawTally = new Map()
const rejectedTally = new Map()
const unmappedTally = new Map()
const facetCounts = new Map()
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1)

for (const record of records) {
  const groups = new Set()

  for (const raw of record.rawCategories ?? []) {
    bump(rawTally, raw)
    if (isRejected(raw)) {
      bump(rejectedTally, raw)
      continue
    }
    const group = groupOf(raw)
    if (group) groups.add(group)
    else bump(unmappedTally, raw)
  }

  if (groups.size === 0) groups.add(cfg.fallback)
  record.categories = [...groups].sort()
  for (const g of record.categories) bump(facetCounts, g)
}

// Rewrite books.ndjson in place, preserving the sort the validator enforces.
await writeFile(BOOKS, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')

const facets = [...facetCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([name, count]) => ({ name, count }))

const authors = new Map()
for (const r of records) if (r.author) bump(authors, r.author)

await writeFile(
  FACETS,
  JSON.stringify(
    {
      generated: new Date().toISOString().slice(0, 10),
      total: records.length,
      categories: facets,
      topAuthors: [...authors.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100)
        .map(([name, count]) => ({ name, count })),
    },
    null,
    2,
  ) + '\n',
  'utf8',
)

const fallbackCount = facetCounts.get(cfg.fallback) ?? 0
const fallbackPct = ((fallbackCount / records.length) * 100).toFixed(1)
const top = (map, n) =>
  [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

const table = (rows) =>
  ['| Category | Works |', '|---|---|', ...rows.map(([c, n]) => `| ${c} | ${n} |`)].join('\n')

await mkdir(dirname(REPORT), { recursive: true })
await writeFile(
  REPORT,
  `# Category coverage

Generated ${new Date().toISOString().slice(0, 10)} from ${records.length} records.

## Facets

${table(facets.map((f) => [f.name, f.count]))}

Fallback \`${cfg.fallback}\`: **${fallbackCount} works (${fallbackPct}%)**.

## Rejected as maintenance noise

${rejectedTally.size} distinct categories rejected. Listed so over-rejection is
visible rather than silent — anything here that reads as a genuine subject is a
bug in \`config/taxonomy.json\`.

${table(top(rejectedTally, 40))}

## Surviving but unmapped

These passed the reject filter but matched no group, so their works fall back to
\`${cfg.fallback}\`. The highest-count entries are the best candidates for new
group terms.

${table(top(unmappedTally, 50))}

## Raw category frequency

${table(top(rawTally, 50))}
`,
  'utf8',
)

console.log(`facets: ${facets.length} categories over ${records.length} records`)
for (const f of facets) console.log(`  ${String(f.count).padStart(6)}  ${f.name}`)
console.log(`\nfallback ${cfg.fallback}: ${fallbackCount} (${fallbackPct}%)`)
console.log(`rejected ${rejectedTally.size} distinct, unmapped ${unmappedTally.size} distinct`)
console.log(`report -> plans/reports/category-coverage.md`)
