/**
 * Vietnamese-aware text folding for search matching.
 *
 * Shared deliberately between the build script (which folds titles into the
 * index) and the browser (which folds the query). If these two ever diverged,
 * search would silently stop matching — so there is exactly one implementation.
 *
 * Folding is for MATCHING ONLY. Display always uses the original string:
 * stripped Vietnamese is a different word, not a neutral variant.
 */

/**
 * NFD decomposition separates most Vietnamese tone and vowel marks into
 * combining characters, which this strips. But đ/Đ is a distinct letter, not a
 * d with a diacritic, so NFD leaves it untouched and it must be mapped by hand.
 * Missing this is the classic Vietnamese folding bug: "dong" would never match
 * "đông".
 */
export function fold(input) {
  if (!input) return ''
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining tone and vowel marks
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

/** Split a folded string into search tokens. */
export function tokenize(input) {
  return fold(input).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}
