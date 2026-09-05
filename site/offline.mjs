/**
 * Offline book storage in IndexedDB, with font-stripping on the way in.
 *
 * Why IndexedDB and not localStorage: this stores Blobs of real size.
 * localStorage caps near 5MB and holds strings only, so a single book would
 * both overflow it and need base64, inflating it by a third.
 *
 * Why strip fonts: a Wikisource EPUB is ~4.35MB, of which ~7.7MB of its 8.2MB
 * uncompressed payload is four embedded FreeSerif fonts repeated in every
 * single file. The text itself is ~370KB. The exporter offers no way to omit
 * them — `&fonts=` was tested against both epub and epub-3 and returned a
 * byte-identical file — so the stripping has to happen here, after download.
 *
 * The original download is never altered. This applies only to the offline
 * copy, and only when the user asks for it.
 */
const DB_NAME = 'book-offline'
const DB_VERSION = 1
const STORE = 'books'

let dbPromise = null

export function isSupported() {
  return typeof indexedDB !== 'undefined'
}

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'ord' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

/**
 * Remove embedded fonts from an EPUB and repackage it.
 *
 * Returns the original bytes untouched if anything looks wrong — a slightly
 * large book that opens is strictly better than a small one that does not.
 */
function stripFonts(buffer) {
  const fflate = globalThis.fflate
  if (!fflate) return { bytes: new Uint8Array(buffer), stripped: false }

  try {
    const files = fflate.unzipSync(new Uint8Array(buffer))
    const out = {}

    // The OCF spec requires `mimetype` to be the first entry and stored
    // uncompressed. fflate preserves object insertion order, so it goes in
    // first; getting this wrong produces a file readers reject without a
    // useful error.
    if (files['mimetype']) out['mimetype'] = [files['mimetype'], { level: 0 }]

    let removed = 0
    for (const [name, bytes] of Object.entries(files)) {
      if (name === 'mimetype') continue

      if (/^OPS\/fonts\//i.test(name) || /\.(ttf|otf|woff2?)$/i.test(name)) {
        removed++
        continue
      }

      if (/\.css$/i.test(name)) {
        const css = fflate.strFromU8(bytes).replace(/@font-face\s*\{[^}]*\}/gi, '')
        out[name] = fflate.strToU8(css)
        continue
      }

      out[name] = bytes
    }

    if (removed === 0) return { bytes: new Uint8Array(buffer), stripped: false }

    const zipped = fflate.zipSync(out)
    // Sanity check: a repack that grew, or lost the mimetype, is not trusted.
    if (!out['mimetype'] || zipped.length >= buffer.byteLength) {
      return { bytes: new Uint8Array(buffer), stripped: false }
    }
    return { bytes: zipped, stripped: true }
  } catch {
    return { bytes: new Uint8Array(buffer), stripped: false }
  }
}

/**
 * Download a book and store it offline.
 * @param {number} ord
 * @param {{title: string, url: string, strip?: boolean}} opts
 */
export async function save(ord, { title, url, strip = true }) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`)
  const buffer = await res.arrayBuffer()
  const originalSize = buffer.byteLength

  const { bytes, stripped } = strip
    ? stripFonts(buffer)
    : { bytes: new Uint8Array(buffer), stripped: false }

  const record = {
    ord,
    title,
    blob: new Blob([bytes], { type: 'application/epub+zip' }),
    size: bytes.length,
    originalSize,
    stripped,
    savedAt: new Date().toISOString(),
  }

  try {
    await tx('readwrite', (store) => store.put(record))
  } catch (err) {
    if (err?.name === 'QuotaExceededError') {
      const { usage, quota } = await usageEstimate()
      throw new Error(
        `Not enough space to save this book. Using ${fmt(usage)} of ${fmt(quota)}. ` +
          `Remove some offline books and try again.`,
      )
    }
    throw err
  }
  return record
}

export const get = (ord) => tx('readonly', (store) => store.get(ord))
export const remove = (ord) => tx('readwrite', (store) => store.delete(ord))
export const all = () => tx('readonly', (store) => store.getAll())

export async function has(ord) {
  return Boolean(await get(ord))
}

export async function clear() {
  return tx('readwrite', (store) => store.clear())
}

/**
 * Ask the browser to keep this data. It may refuse, and Safari in particular
 * evicts IndexedDB after a period of inactivity — so offline copies are a
 * cache, never durable storage, and the UI says so.
 */
export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

export async function usageEstimate() {
  try {
    const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) ?? {}
    return { usage, quota }
  } catch {
    return { usage: 0, quota: 0 }
  }
}

export function fmt(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
