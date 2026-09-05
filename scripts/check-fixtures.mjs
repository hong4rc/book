#!/usr/bin/env node
/**
 * Assertions for Vietnamese text folding and search behaviour.
 *
 * Folding is the likeliest place for this project to break silently: if it
 * regresses, search keeps "working" but stops matching, and nothing throws.
 * These cases cover every Vietnamese tone mark, both vowel modifiers (ă â ê ô
 * ơ ư), and the đ/Đ case that NFD does NOT decompose — the classic bug, where
 * "dong" fails to match "đông".
 */
import { fold, tokenize } from '../docs/fold.mjs'

let failures = 0
const check = (label, actual, expected) => {
  const ok = actual === expected
  if (!ok) {
    console.error(`FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`)
    failures++
  }
  return ok
}

/* ---------------------------------------------- every tone mark folds away */
const tones = [
  ['a', 'a'], ['à', 'a'], ['á', 'a'], ['ả', 'a'], ['ã', 'a'], ['ạ', 'a'],
  ['ă', 'a'], ['ằ', 'a'], ['ắ', 'a'], ['ẳ', 'a'], ['ẵ', 'a'], ['ặ', 'a'],
  ['â', 'a'], ['ầ', 'a'], ['ấ', 'a'], ['ẩ', 'a'], ['ẫ', 'a'], ['ậ', 'a'],
  ['e', 'e'], ['è', 'e'], ['é', 'e'], ['ẻ', 'e'], ['ẽ', 'e'], ['ẹ', 'e'],
  ['ê', 'e'], ['ề', 'e'], ['ế', 'e'], ['ể', 'e'], ['ễ', 'e'], ['ệ', 'e'],
  ['i', 'i'], ['ì', 'i'], ['í', 'i'], ['ỉ', 'i'], ['ĩ', 'i'], ['ị', 'i'],
  ['o', 'o'], ['ò', 'o'], ['ó', 'o'], ['ỏ', 'o'], ['õ', 'o'], ['ọ', 'o'],
  ['ô', 'o'], ['ồ', 'o'], ['ố', 'o'], ['ổ', 'o'], ['ỗ', 'o'], ['ộ', 'o'],
  ['ơ', 'o'], ['ờ', 'o'], ['ớ', 'o'], ['ở', 'o'], ['ỡ', 'o'], ['ợ', 'o'],
  ['u', 'u'], ['ù', 'u'], ['ú', 'u'], ['ủ', 'u'], ['ũ', 'u'], ['ụ', 'u'],
  ['ư', 'u'], ['ừ', 'u'], ['ứ', 'u'], ['ử', 'u'], ['ữ', 'u'], ['ự', 'u'],
  ['y', 'y'], ['ỳ', 'y'], ['ý', 'y'], ['ỷ', 'y'], ['ỹ', 'y'], ['ỵ', 'y'],
  // đ is a distinct letter, not a diacritic; NFD leaves it alone.
  ['đ', 'd'], ['Đ', 'd'],
]
for (const [input, expected] of tones) check(`fold(${input})`, fold(input), expected)

/* ------------------------------------------------- real titles and queries */
const titles = [
  ['Truyện Kiều', 'truyen kieu'],
  ['Chinh phụ ngâm', 'chinh phu ngam'],
  ['Lục Vân Tiên', 'luc van tien'],
  ['Cung oán ngâm khúc', 'cung oan ngam khuc'],
  ['Bình Ngô đại cáo', 'binh ngo dai cao'],
  ['Nguyễn Du', 'nguyen du'],
  ['Đặng Trần Côn', 'dang tran con'],
  ['Nguyễn Đình Chiểu', 'nguyen dinh chieu'],
  ['Hồ Xuân Hương', 'ho xuan huong'],
  ['Đường về quê mẹ', 'duong ve que me'],
]
for (const [title, expected] of titles) check(`fold(${title})`, fold(title), expected)

/* ------------------------------------- accentless query matches accented title */
const matches = [
  ['truyen kieu', 'Truyện Kiều'],
  ['Truyện Kiều', 'Truyện Kiều'],
  ['TRUYEN KIEU', 'Truyện Kiều'],
  ['kieu', 'Truyện Kiều'],
  ['dang tran con', 'Đặng Trần Côn'],
  ['binh ngo', 'Bình Ngô đại cáo'],
  ['duong', 'Đường về quê mẹ'],
]
for (const [query, title] of matches) {
  const haystack = fold(title)
  const ok = tokenize(query).every((t) => haystack.includes(t))
  if (!ok) {
    console.error(`FAIL query ${JSON.stringify(query)} should match ${JSON.stringify(title)}`)
    failures++
  }
}

/* ------------------------------- distinct words must NOT be merged by folding */
// Folding removes tone marks, so some genuinely different words collapse — that
// is accepted for matching. But đ/d handling must not merge a word with one
// that differs by a real letter.
const distinct = [['ma', 'mua'], ['con', 'còng'], ['dan', 'dam']]
for (const [a, b] of distinct) {
  if (fold(a) === fold(b)) {
    console.error(`FAIL fold merged distinct words: ${a} / ${b}`)
    failures++
  }
}

/* ----------------------------------------------------------------- tokenize */
check('tokenize spacing', tokenize('  Truyện   Kiều  ').join('|'), 'truyen|kieu')
check('tokenize punctuation', tokenize('Bình Ngô, đại cáo!').join('|'), 'binh|ngo|dai|cao')
check('tokenize empty', tokenize('').length, 0)

if (failures > 0) {
  console.error(`\nFAILED: ${failures} assertion(s)`)
  process.exit(1)
}
console.log(`OK: ${tones.length + titles.length + matches.length + distinct.length + 3} folding assertions passed`)
