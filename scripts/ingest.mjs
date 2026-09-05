#!/usr/bin/env node
/**
 * Ingest driver: run every adapter, merge, sort, write data/books.ndjson.
 *
 * Guards against the worst failure mode in the pipeline — a partially failed
 * API run looking exactly like a legitimate mass deletion. If the record count
 * drops more than SHRINK_LIMIT below the previous run, this exits non-zero and
 * writes nothing, so a bad run can never be committed as a "deletion".
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { stats } from './lib/http.mjs'
import * as viWikisource from './adapters/vi-wikisource.mjs'
import * as customCsv from './adapters/custom-csv.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(root, 'data/books.ndjson')
const SHRINK_LIMIT = 0.05 // refuse a run that loses more than 5% of records

const adapters = [viWikisource, customCsv]
const started = Date.now()
const log = (msg) => console.log(msg)

async function previousCount() {
  try {
    const text = await readFile(OUT, 'utf8')
    return text.trim() === '' ? 0 : text.trim().split('\n').length
  } catch {
    return 0
  }
}

const before = await previousCount()
const merged = new Map()

for (const adapter of adapters) {
  log(`\n[${adapter.id}]`)
  const records = await adapter.fetchRecords({ log })
  log(`  -> ${records.length} record(s)`)
  // Later adapters win on id collision, letting a custom entry override.
  for (const record of records) merged.set(record.id, record)
}

const records = [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

if (records.length === 0) {
  console.error('\nFAILED: no records produced; refusing to write an empty catalogue')
  process.exit(1)
}

if (before > 0 && records.length < before * (1 - SHRINK_LIMIT)) {
  console.error(
    `\nFAILED: record count fell from ${before} to ${records.length} ` +
      `(more than ${SHRINK_LIMIT * 100}%). This usually means a partial API failure, ` +
      `not a real deletion. Nothing was written; re-run before committing.`,
  )
  process.exit(1)
}

await mkdir(resolve(root, 'data'), { recursive: true })
await writeFile(OUT, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')

const { liveRequests, cacheHits } = stats()
const withAuthor = records.filter((r) => r.author !== null).length
const elapsed = ((Date.now() - started) / 1000).toFixed(0)

log(`\nwrote ${records.length} record(s) to data/books.ndjson`)
log(`  previous run    : ${before}`)
log(`  with author     : ${withAuthor} (${((withAuthor / records.length) * 100).toFixed(1)}%)`)
log(`  live requests   : ${liveRequests}`)
log(`  cache hits      : ${cacheHits}`)
log(`  elapsed         : ${elapsed}s`)
