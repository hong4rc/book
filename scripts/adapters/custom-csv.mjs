/**
 * Operator-supplied catalogue adapter.
 *
 * Reads any CSV dropped in data/custom/ and maps it into the same record
 * schema. This is the escape hatch: a catalogue the operator is entitled to
 * use enters here with no change to the rest of the pipeline.
 *
 * Expected header (extra columns are ignored):
 *   title,author,sourceUrl,downloadUrl,format,categories,license,language
 *
 * `categories` is semicolon-separated. `license` and `language` default to
 * "unknown" and "vi" respectively.
 */
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

export const id = 'custom'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DIR = resolve(root, 'data/custom')

/**
 * Minimal RFC4180-ish parser: handles quoted fields, escaped quotes ("")
 * and embedded newlines. Hand-rolled to keep the pipeline dependency-free.
 */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += ch
      continue
    }

    if (ch === '"') { quoted = true }
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch !== '\r') { field += ch }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }

  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim())
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}

export async function fetchRecords({ log }) {
  let files
  try {
    files = (await readdir(DIR)).filter((f) => f.toLowerCase().endsWith('.csv'))
  } catch {
    return [] // directory absent is normal, not an error
  }
  if (files.length === 0) return []

  const updated = new Date().toISOString().slice(0, 10)
  const records = []

  for (const file of files) {
    const rows = parseCsv(await readFile(join(DIR, file), 'utf8'))
    log(`  ${file}: ${rows.length} row(s)`)

    for (const r of rows) {
      if (!r.title || !r.sourceUrl) continue // unusable without these
      records.push({
        schemaVersion: 1,
        id: `${id}:${r.title}`,
        title: r.title,
        author: r.author || null,
        language: r.language || 'vi',
        source: id,
        sourceUrl: r.sourceUrl,
        downloads: r.downloadUrl
          ? [{ format: (r.format || 'epub').toLowerCase(), url: r.downloadUrl }]
          : [{ format: 'epub', url: r.sourceUrl }],
        categories: [],
        rawCategories: r.categories ? r.categories.split(';').map((c) => c.trim()).filter(Boolean) : [],
        chapters: 0,
        quality: null,
        license: r.license || 'unknown',
        updated,
        extra: { sourceFile: file },
      })
    }
  }
  return records
}
