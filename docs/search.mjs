/**
 * Client-side search over the whole catalogue.
 *
 * A linear scan over ~6.5k records holding only a title and an author is
 * cheaper than the machinery needed to avoid it — but only if the per-candidate
 * work stays genuinely small. Two things keep it that way:
 *
 *   - the folded title is precomputed at build time, not derived per keystroke
 *   - token regexes are compiled once per query, not once per candidate
 *
 * Both matter most for a one-character query, which matches nearly the whole
 * corpus and is exactly when the user is typing fastest.
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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * @param {string} query
 * @param {{categories?: Set<number>, limit?: number}} opts
 * @returns {{ordinals: number[], total: number}} best first, plus the
 *   uncapped match count — returned from the same pass so the caller never
 *   has to run the scan twice to render a "N results" line.
 */
export function search(query, opts = {}) {
  if (!index) return { ordinals: [], total: 0 }
  const { categories, limit = 100 } = opts
  const queryFolded = fold(query)
  const tokens = tokenize(query)
  const filtering = categories && categories.size > 0

  // Compiled once per query rather than once per book.
  const boundary = tokens.map((t) => new RegExp(`(^|\\s)${escapeRe(t)}`))
  const results = []

  for (let ord = 0; ord < index.books.length; ord++) {
    const entry = index.books[ord]
    if (!entry) continue
    const [title, , foldedText, cats, titleFoldLength] = entry

    if (filtering) {
      // Facets are AND-ed with the search but OR-ed among themselves: picking
      // two categories widens the category filter, as a reader expects.
      if (!cats.some((c) => categories.has(c))) continue
    }

    if (tokens.length === 0) {
      results.push([ord, -title.length]) // browsing: shortest titles first
      continue
    }

    // Every token must appear, so a multi-word query narrows rather than widens.
    let matched = true
    for (const token of tokens) {
      if (!foldedText.includes(token)) { matched = false; break }
    }
    if (!matched) continue

    // A slice, not a fold: the expensive normalize/regex work was done at build
    // time and its result is the front of foldedText.
    const foldedTitle = foldedText.slice(0, titleFoldLength)

    let s = 0
    if (foldedTitle === queryFolded) s += 1000            // exact title
    else if (foldedTitle.startsWith(queryFolded)) s += 500 // title prefix
    else if (foldedTitle.includes(queryFolded)) s += 250   // phrase inside title

    // Reward matches at a word boundary over ones buried mid-word.
    for (const re of boundary) if (re.test(foldedTitle)) s += 40

    // Prefer shorter titles: with equal evidence the more specific match wins.
    s += Math.max(0, 60 - title.length / 4)
    results.push([ord, s])
  }

  results.sort((a, b) => b[1] - a[1] || a[0] - b[0])
  return {
    ordinals: results.slice(0, limit).map(([ord]) => ord),
    total: results.length,
  }
}
