/**
 * Client-side search over the whole catalogue.
 *
 * A linear scan sounds naive, but with ~6.5k records holding only a title and
 * an author it costs well under a millisecond — far cheaper than the machinery
 * needed to avoid it. No index library, no WASM, no network call per query.
 */
import { fold, tokenize } from './fold.mjs'

let index = null

export async function loadIndex(url = './data/index.json') {
  if (index) return index
  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not load search index (HTTP ${res.status})`)
  index = await res.json()
  return index
}

export const getIndex = () => index

/**
 * Score one book against the folded query.
 * Returns -1 when it does not match at all.
 */
function score(foldedText, title, queryFolded, tokens) {
  // Every token must appear, so that a multi-word query narrows rather than widens.
  for (const token of tokens) {
    if (!foldedText.includes(token)) return -1
  }

  let s = 0
  const foldedTitle = fold(title)
  if (foldedTitle === queryFolded) s += 1000            // exact title
  else if (foldedTitle.startsWith(queryFolded)) s += 500 // title prefix
  else if (foldedTitle.includes(queryFolded)) s += 250   // phrase inside title

  // Reward matches at a word boundary over ones buried mid-word.
  for (const token of tokens) {
    if (new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(foldedTitle)) s += 40
  }

  // Prefer shorter titles: with equal evidence the more specific match wins.
  s += Math.max(0, 60 - title.length / 4)
  return s
}

/**
 * @param {string} query
 * @param {{categories?: Set<number>, limit?: number}} opts
 * @returns {number[]} ordinals, best first
 */
export function search(query, opts = {}) {
  if (!index) return []
  const { categories, limit = 100 } = opts
  const queryFolded = fold(query)
  const tokens = tokenize(query)
  const results = []

  for (let ord = 0; ord < index.books.length; ord++) {
    const [title, , foldedText, cats] = index.books[ord]

    if (categories && categories.size > 0) {
      // Facets are AND-ed with search but OR-ed among themselves: picking two
      // categories widens the category filter, as a reader expects.
      if (!cats.some((c) => categories.has(c))) continue
    }

    if (tokens.length === 0) {
      results.push([ord, -title.length]) // browsing: shortest titles first
      continue
    }

    const s = score(foldedText, title, queryFolded, tokens)
    if (s >= 0) results.push([ord, s])
  }

  results.sort((a, b) => b[1] - a[1] || a[0] - b[0])
  return results.slice(0, limit).map(([ord]) => ord)
}

/** Total matches without the result cap, for the "N results" line. */
export function count(query, opts = {}) {
  return search(query, { ...opts, limit: Infinity }).length
}
