/**
 * Vietnamese Wikisource adapter.
 *
 * Uses the MediaWiki API only; never scrapes rendered HTML.
 *
 * Two passes, because they have very different costs:
 *   1. enumerate every ns=0 title (cheap, 500 per request)
 *   2. hydrate metadata for root works only (50 per request)
 *
 * Measured during planning: ~36% of ns=0 titles are root works and ~64% are
 * chapter subpages, so hydrating roots only is a large saving.
 */
import { getJson } from '../lib/http.mjs'

export const id = 'vi.wikisource'

const API = 'https://vi.wikisource.org/w/api.php'
const WIKI = 'https://vi.wikisource.org/wiki/'
const EXPORT = 'https://ws-export.wmcloud.org/'
const LANG = 'vi'
const AUTHOR_NS = 102 // "Tác gia"; verified against siteinfo, NOT the usual 106
const CATEGORY_PREFIX = 'Thể loại:'
const AUTHOR_PREFIX = 'Tác gia:'
const FORMATS = ['epub', 'pdf', 'mobi']
const BATCH = 50 // MediaWiki caps `titles` at 50 for anonymous clients

// Some titles here are extraordinarily long (translated diplomatic statements
// run to several hundred characters). Fifty of those in one query string
// returns HTTP 414 URI Too Long, so batches are bounded by encoded length as
// well as count, and the length bound is the one that actually binds.
const TITLES_BUDGET = 1500

/** Group titles into batches bounded by both count and encoded query length. */
function batchTitles(titles) {
  const batches = []
  let current = []
  let length = 0

  for (const title of titles) {
    const cost = encodeURIComponent(title).length + 3 // + encoded "|" separator
    // Flush when adding this title would breach either bound. A single title
    // over budget still gets its own batch rather than being dropped.
    if (current.length > 0 && (current.length >= BATCH || length + cost > TITLES_BUDGET)) {
      batches.push(current)
      current = []
      length = 0
    }
    current.push(title)
    length += cost
  }
  if (current.length > 0) batches.push(current)
  return batches
}

const api = (params) => `${API}?${new URLSearchParams({ format: 'json', ...params })}`

/** Enumerate every non-redirect title in the main namespace. */
async function enumerateTitles(log) {
  const titles = []
  let cont
  do {
    const body = await getJson(
      api({
        action: 'query',
        list: 'allpages',
        apnamespace: '0',
        aplimit: '500',
        apfilterredir: 'nonredirects',
        ...(cont ? { apcontinue: cont } : {}),
      }),
    )
    for (const p of body.query.allpages) titles.push(p.title)
    cont = body.continue?.apcontinue
    if (titles.length % 5000 === 0) log(`  enumerated ${titles.length} titles`)
  } while (cont)
  return titles
}

/**
 * Split titles into root works and a subpage count per root.
 *
 * A title containing "/" is a chapter of its parent. A subpage whose parent
 * does not exist is promoted to a root, so a work whose own title legitimately
 * contains a slash is not silently lost.
 */
function partition(titles) {
  const all = new Set(titles)
  const roots = []
  const chapterCount = new Map()

  for (const title of titles) {
    const slash = title.indexOf('/')
    if (slash === -1) {
      roots.push(title)
      continue
    }
    const parent = title.slice(0, slash)
    if (all.has(parent)) {
      chapterCount.set(parent, (chapterCount.get(parent) ?? 0) + 1)
    } else {
      roots.push(title) // orphaned subpage: treat as a work in its own right
    }
  }
  return { roots, chapterCount }
}

/**
 * Fetch categories and author links for a batch of titles.
 * Both props share one request; continuation is merged per title.
 */
async function hydrate(batch) {
  const acc = new Map(batch.map((t) => [t, { categories: [], authors: [] }]))
  let cont = {}

  do {
    const body = await getJson(
      api({
        action: 'query',
        prop: 'categories|links',
        cllimit: 'max',
        pllimit: 'max',
        plnamespace: String(AUTHOR_NS),
        titles: batch.join('|'),
        ...cont,
      }),
    )

    for (const page of Object.values(body.query?.pages ?? {})) {
      const entry = acc.get(page.title)
      if (!entry) continue // normalised title differs; skipped deliberately
      for (const c of page.categories ?? []) {
        entry.categories.push(c.title.replace(CATEGORY_PREFIX, ''))
      }
      for (const l of page.links ?? []) {
        entry.authors.push(l.title.replace(AUTHOR_PREFIX, ''))
      }
    }

    cont = body.continue ?? {}
  } while (Object.keys(cont).length > 0)

  return acc
}

/** Wikisource proofread levels arrive as categories; route them out of subjects. */
function readQuality(categories) {
  const pct = categories.find((c) => /^\d+%$/.test(c))
  if (pct) return pct
  if (categories.includes('Chưa hiệu đính')) return 'Chưa hiệu đính'
  return null
}

/**
 * Licence from the licence category.
 * "PVCC" = phạm vi công cộng (public domain). Wikisource policy defaults to
 * public domain, so PD is the fallback when no explicit tag is present.
 */
function readLicense(categories) {
  if (categories.some((c) => /creative commons/i.test(c))) return 'CC-BY-SA-4.0'
  return 'PD'
}

const downloadUrl = (title, format) =>
  `${EXPORT}?${new URLSearchParams({ lang: LANG, format, page: title })}`

export async function fetchRecords({ log }) {
  log('pass 1: enumerating main-namespace titles')
  const titles = await enumerateTitles(log)
  const { roots, chapterCount } = partition(titles)
  log(`  ${titles.length} titles -> ${roots.length} root works, ${titles.length - roots.length} chapters`)

  const batches = batchTitles(roots)
  log(`pass 2: hydrating ${roots.length} works in ${batches.length} length-bounded batches`)
  const updated = new Date().toISOString().slice(0, 10)
  const records = []
  let done = 0

  for (const batch of batches) {
    const meta = await hydrate(batch)

    for (const title of batch) {
      const { categories, authors } = meta.get(title) ?? { categories: [], authors: [] }
      const quality = readQuality(categories)

      records.push({
        schemaVersion: 1,
        id: `${id}:${title}`,
        title,
        // A wrong author is worse than an absent one, so no guessing: only a
        // real link into the author namespace counts.
        author: authors.length > 0 ? authors[0] : null,
        language: LANG,
        source: id,
        sourceUrl: WIKI + encodeURIComponent(title.replace(/ /g, '_')),
        downloads: FORMATS.map((format) => ({ format, url: downloadUrl(title, format) })),
        categories: [], // populated by derive-facets.mjs
        rawCategories: categories,
        chapters: chapterCount.get(title) ?? 0,
        quality,
        license: readLicense(categories),
        updated,
        extra: {
          // A versions/disambiguation page rather than a work. Kept, because
          // ws-export still produces a valid EPUB for these, but flagged so the
          // site can label them honestly.
          isVersionsPage: categories.includes('Trang các phiên bản'),
          authorCount: authors.length,
        },
      })
    }

    done += batch.length
    if (done % 1000 < batch.length) log(`  hydrated ${done}/${roots.length}`)
  }

  return records
}
