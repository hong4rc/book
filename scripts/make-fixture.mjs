#!/usr/bin/env node
/**
 * Emits the hand-checked starter fixture for data/books.ndjson.
 *
 * Generated rather than hand-typed so that percent-encoding of Vietnamese
 * titles in the download URLs and the ascending `id` sort are both correct by
 * construction. These four works were fetched and verified during planning:
 * each returned a valid `application/epub+zip` from ws-export.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'vi.wikisource'
const WIKI = 'https://vi.wikisource.org/wiki/'
const EXPORT = 'https://ws-export.wmcloud.org/'
const FORMATS = ['epub', 'pdf', 'mobi']
const updated = new Date().toISOString().slice(0, 10)

/** Bibliographic facts about four classic works of Vietnamese literature. */
const works = [
  { title: 'Chinh phụ ngâm', author: 'Đặng Trần Côn', chapters: 0 },
  { title: 'Cung oán ngâm khúc', author: 'Nguyễn Gia Thiều', chapters: 0 },
  { title: 'Lục Vân Tiên', author: 'Nguyễn Đình Chiểu', chapters: 0 },
  { title: 'Truyện Kiều', author: 'Nguyễn Du', chapters: 0 },
]

const downloadUrl = (title, format) =>
  `${EXPORT}?${new URLSearchParams({ lang: 'vi', format, page: title })}`

const records = works
  .map((w) => ({
    schemaVersion: 1,
    id: `${SOURCE}:${w.title}`,
    title: w.title,
    author: w.author,
    language: 'vi',
    source: SOURCE,
    sourceUrl: WIKI + encodeURIComponent(w.title.replace(/ /g, '_')),
    downloads: FORMATS.map((format) => ({ format, url: downloadUrl(w.title, format) })),
    categories: [],
    rawCategories: [],
    chapters: w.chapters,
    quality: null,
    license: 'PD',
    updated,
  }))
  // Sort by code point to match the ordering the validator enforces.
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

await mkdir(resolve(root, 'data'), { recursive: true })
await writeFile(
  resolve(root, 'data/books.ndjson'),
  records.map((r) => JSON.stringify(r)).join('\n') + '\n',
  'utf8',
)
console.log(`wrote ${records.length} fixture record(s)`)
