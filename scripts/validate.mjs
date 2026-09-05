#!/usr/bin/env node
/**
 * Gate for data/books.ndjson.
 *
 * Checks three things the JSON Schema alone cannot:
 *   1. every line is schema-valid
 *   2. `id` is unique
 *   3. records are sorted ascending by `id`
 *
 * Sort order is load-bearing, not cosmetic: the weekly refresh (Phase 5) opens
 * a pull request, and a sorted file makes that a small reviewable diff instead
 * of a whole-file rewrite.
 */
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
// Draft 2020-12 entry point; ajv's default export only understands draft-07
// and rejects the schema's $schema declaration.
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = process.argv[2] ?? resolve(root, 'data/books.ndjson')
const schemaPath = resolve(root, 'schema/book.schema.json')

const ajv = new Ajv({ allErrors: true, strict: true })
addFormats(ajv)
const validate = ajv.compile(JSON.parse(await readFile(schemaPath, 'utf8')))

const errors = []
const seen = new Map()
let previousId = null
let lineNo = 0
let count = 0

const rl = createInterface({
  input: createReadStream(dataPath, 'utf8'),
  crlfDelay: Infinity,
})

for await (const line of rl) {
  lineNo++
  if (line.trim() === '') continue

  let record
  try {
    record = JSON.parse(line)
  } catch (err) {
    errors.push(`line ${lineNo}: not valid JSON — ${err.message}`)
    continue
  }

  if (!validate(record)) {
    for (const e of validate.errors) {
      errors.push(`line ${lineNo}: ${e.instancePath || '/'} ${e.message}`)
    }
  }

  const { id } = record
  if (typeof id === 'string') {
    if (seen.has(id)) {
      errors.push(`line ${lineNo}: duplicate id ${JSON.stringify(id)} (first seen on line ${seen.get(id)})`)
    } else {
      seen.set(id, lineNo)
    }
    // Compare by code point so ordering is stable across locales; a
    // locale-aware collation would sort differently on different machines
    // and make CI disagree with a developer's laptop.
    if (previousId !== null && id < previousId) {
      errors.push(`line ${lineNo}: out of order — ${JSON.stringify(id)} follows ${JSON.stringify(previousId)}`)
    }
    previousId = id
  }

  count++
}

if (errors.length > 0) {
  const shown = errors.slice(0, 50)
  for (const e of shown) console.error(`error: ${e}`)
  if (errors.length > shown.length) {
    console.error(`... and ${errors.length - shown.length} more`)
  }
  console.error(`\nFAILED: ${errors.length} problem(s) across ${count} record(s)`)
  process.exit(1)
}

console.log(`OK: ${count} record(s) valid, unique, and sorted`)
