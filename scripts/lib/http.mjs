/**
 * Shared HTTP client for every adapter.
 *
 * Three responsibilities, all of them non-optional:
 *   - identify honestly (Wikimedia User-Agent policy)
 *   - stay under rate limits (probing this API returned HTTP 429)
 *   - cache to disk, so re-runs cost the upstream nothing
 *
 * Adapters must not call fetch() directly; routing everything through here is
 * what makes the pacing guarantee actually hold.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE_DIR = resolve(root, '.cache')

// Wikimedia asks for a descriptive agent with a contact route. Overridable so
// CI can supply a maintained contact without editing source.
const UA =
  process.env.CATALOG_UA ??
  'book-catalog/1.0 (https://github.com/hong4rc/book; +https://github.com/hong4rc)'

const MIN_INTERVAL_MS = Number(process.env.CATALOG_MIN_INTERVAL_MS ?? 1000)
const MAX_RETRIES = 4

let lastRequestAt = 0
let liveRequests = 0
let cacheHits = 0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Serialised pacing: guarantees at least MIN_INTERVAL_MS between live calls. */
async function pace() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()
}

const cachePath = (url) =>
  join(CACHE_DIR, createHash('sha1').update(url).digest('hex') + '.json')

/**
 * GET a URL expecting JSON, with disk caching and retry on 429/503.
 * @param {string} url
 * @param {{noCache?: boolean}} [opts]
 */
export async function getJson(url, opts = {}) {
  const file = cachePath(url)

  if (!opts.noCache) {
    try {
      const hit = JSON.parse(await readFile(file, 'utf8'))
      cacheHits++
      return hit
    } catch {
      // Cache miss is the normal path on a cold run; fall through and fetch.
    }
  }

  let lastError
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await pace()
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })

      // 429/503 are the throttle signals actually observed against this API.
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 2000 * (attempt + 1)
        lastError = new Error(`HTTP ${res.status}`)
        if (attempt < MAX_RETRIES) {
          console.warn(`  throttled (${res.status}), backing off ${backoff}ms`)
          await sleep(backoff)
          continue
        }
      }

      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)

      const body = await res.json()
      liveRequests++
      await mkdir(CACHE_DIR, { recursive: true })
      await writeFile(file, JSON.stringify(body), 'utf8')
      return body
    } catch (err) {
      lastError = err
      if (attempt < MAX_RETRIES) {
        await sleep(2000 * (attempt + 1))
        continue
      }
    }
  }
  throw new Error(`giving up after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`)
}

export const stats = () => ({ liveRequests, cacheHits })
