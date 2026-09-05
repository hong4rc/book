/**
 * Bookmarks, stored in localStorage.
 *
 * Only ids and titles live here — a few KB even for hundreds of books, which
 * is what makes localStorage the right choice. Downloaded EPUBs go to
 * IndexedDB instead (see offline.mjs); they would blow the ~5MB cap instantly.
 *
 * Every access is guarded: private browsing modes can throw on read or write,
 * and a storage failure must never break the page.
 */
const KEY = 'book:bookmarks:v1'

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function write(map) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
    return true
  } catch {
    return false // quota or blocked storage; caller decides what to say
  }
}

export function isBookmarked(ord) {
  return Object.hasOwn(read(), String(ord))
}

export function toggle(ord, title) {
  const map = read()
  const key = String(ord)
  if (Object.hasOwn(map, key)) delete map[key]
  else map[key] = { title, addedAt: new Date().toISOString() }
  write(map)
  return Object.hasOwn(map, key)
}

/** Ordinals, most recently added first. */
export function list() {
  return Object.entries(read())
    .filter(([ord, value]) => Number.isInteger(Number(ord)) && value && typeof value === 'object')
    .sort((a, b) => (b[1].addedAt ?? '').localeCompare(a[1].addedAt ?? ''))
    .map(([ord]) => Number(ord))
}

export const size = () => Object.keys(read()).length

/** Export as a JSON blob so a list survives moving between devices. */
export function exportJson() {
  return JSON.stringify({ version: 1, bookmarks: read() }, null, 2)
}

/** Merge an exported list into the current one; returns how many were added. */
export function importJson(text) {
  const parsed = JSON.parse(text)
  const incoming = parsed.bookmarks ?? parsed
  if (typeof incoming !== 'object' || incoming === null) throw new Error('unrecognised bookmark file')

  const map = read()
  let added = 0
  let skipped = 0
  for (const [ord, value] of Object.entries(incoming)) {
    // Validate before storing. An imported file is arbitrary user input, and a
    // bad entry would otherwise be written to localStorage and then crash the
    // Bookmarks view on every later render, with no way to recover from the UI.
    const n = Number(ord)
    if (!Number.isInteger(n) || n < 0 || !value || typeof value !== 'object') {
      skipped++
      continue
    }
    if (!Object.hasOwn(map, ord)) {
      map[ord] = { title: String(value.title ?? ''), addedAt: String(value.addedAt ?? '') }
      added++
    }
  }
  if (added === 0 && skipped > 0) throw new Error(`no usable bookmarks found (${skipped} skipped)`)
  if (!write(map)) throw new Error('could not save bookmarks; storage may be full or blocked')
  return added
}
