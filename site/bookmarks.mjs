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
  for (const [ord, value] of Object.entries(incoming)) {
    if (!Object.hasOwn(map, ord)) {
      map[ord] = value
      added++
    }
  }
  if (!write(map)) throw new Error('could not save bookmarks; storage may be full or blocked')
  return added
}
