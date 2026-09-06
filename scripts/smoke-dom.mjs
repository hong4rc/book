#!/usr/bin/env node
/**
 * Boots the actual page in a DOM and asserts it works.
 *
 * This test exists because its absence was the root cause of a shipped,
 * completely non-functional site: every module passed its unit tests while the
 * page itself was unusable in a browser. Node-level tests cannot catch a
 * missing element id, a boot-time exception, or a storage API that is present
 * but unusable.
 *
 * jsdom provides no `indexedDB`, which makes this a free test of the
 * degradation path: search and download MUST work with offline storage absent.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docs = resolve(root, 'docs')

let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`OK   ${label}`)
  else { console.error(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); failures++ }
}

/* --------------------------------------------------- C1 regression guard */
// The `hidden` attribute hides only via the UA stylesheet's [hidden]{display:none},
// and ANY author `display` declaration outranks it by origin. Without an explicit
// .overlay[hidden] rule, the overlay stays on screen permanently and swallows
// every click on the page. This is a text assertion because jsdom does not
// implement the UA stylesheet cascade.
// Comments are stripped first: the explanatory note above the rule mentions
// `.overlay{display:grid}` literally and would otherwise match as a real rule.
const css = (await readFile(resolve(docs, 'style.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
const overlayHidden = css.indexOf('.overlay[hidden]')
const overlayDisplay = css.search(/\.overlay\s*\{[^}]*display\s*:/)
check(
  '.overlay[hidden] rule exists (author display beats UA [hidden])',
  overlayHidden !== -1,
  'add `.overlay[hidden] { display: none; }` or the page is unclickable',
)
check(
  '.overlay[hidden] precedes .overlay display rule',
  overlayHidden !== -1 && (overlayDisplay === -1 || overlayHidden < overlayDisplay),
)

/* ------------------------------------------------------------- boot the page */
const html = await readFile(resolve(docs, 'index.html'), 'utf8')
const dom = new JSDOM(html, { url: 'https://example.org/book/', pretendToBeVisual: true })
const { window } = dom

for (const key of [
  'window', 'document', 'location', 'history', 'localStorage',
  'HTMLElement', 'Blob', 'URLSearchParams', 'CustomEvent', 'Event',
]) {
  globalThis[key] = window[key]
}
globalThis.URL = window.URL
// `navigator` is an accessor-only global in Node 20+, so plain assignment
// throws. offline.mjs reads navigator.storage defensively, so redefining it is
// enough for the modules under test.
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator,
  configurable: true,
})

// Serve docs/ from disk, mirroring what GitHub Pages returns.
globalThis.fetch = async (url) => {
  const file = resolve(docs, String(url).replace(/^\.\//, ''))
  try {
    return { ok: true, status: 200, json: async () => JSON.parse(await readFile(file, 'utf8')) }
  } catch {
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

// Read the built index directly so assertions can name a real book.
const builtIndex = JSON.parse(await readFile(resolve(docs, 'data/index.json'), 'utf8'))
const getIndexTitle = (ord) => builtIndex.books[ord][0]

const errors = []
window.addEventListener('error', (e) => errors.push(e.message))
process.on('unhandledRejection', (e) => errors.push(`unhandledRejection: ${e?.message ?? e}`))

await import('../docs/app.mjs')

// app.mjs kicks off main() at import time; wait for the first render.
const $ = (sel) => window.document.querySelector(sel)
for (let i = 0; i < 100 && $('#results').children.length === 0; i++) {
  await new Promise((r) => setTimeout(r, 20))
}

/* ------------------------------------------------------------------ asserts */
check('no uncaught errors during boot', errors.length === 0, errors.join('; '))
check('results rendered', $('#results').children.length > 0,
  `#results has ${$('#results').children.length} children`)
check('result count line populated', /result/.test($('#count').textContent),
  `#count = ${JSON.stringify($('#count').textContent)}`)
check('book total shown in header', /\d/.test($('#total').textContent),
  `#total = ${JSON.stringify($('#total').textContent)}`)
check('category facets rendered', $('#facets').children.length >= 5,
  `${$('#facets').children.length} facets`)
check('overlay starts hidden', $('#overlay').hidden === true)

// The whole point of the degradation path: jsdom has no indexedDB.
check('booted with no indexedDB available', typeof window.indexedDB === 'undefined')

// Every id app.mjs reaches for must exist, or a listener silently never binds.
for (const id of ['q', 'results', 'count', 'total', 'facets', 'facets-section',
                  'overlay', 'export', 'import', 'import-file', 'offline-count']) {
  check(`#${id} exists`, $(`#${id}`) !== null)
}

/* ------------------------------------------------------- search interaction */
const q = $('#q')
q.value = 'truyen kieu'
q.dispatchEvent(new window.Event('input', { bubbles: true }))
await new Promise((r) => setTimeout(r, 50))

const firstResult = $('#results .result-title')
check('typing an accentless query returns results', firstResult !== null)
check('accentless query ranks the accented title first',
  firstResult?.textContent === 'Truyện Kiều',
  `got ${JSON.stringify(firstResult?.textContent)}`)

/* ------------------------------------------------------------ deep linking */
// A shared #book/N link must render the catalogue behind the overlay, not an
// empty page.
window.location.hash = '#book/0'
await new Promise((r) => setTimeout(r, 120))
check('deep link renders the list behind the overlay', $('#results').children.length > 0,
  `#results has ${$('#results').children.length} children`)
check('deep link opens the overlay', $('#overlay').hidden === false)

/* ------------------------------------------------- detail panel CONTENTS */
// The previous version asserted only that the overlay OPENED, never what was
// in it — which is exactly how a literal "null" shipped on ~every book.
// Node.append() stringifies non-node values, so a nullish conditional child
// renders as the text "null".
const panelText = () => $('#overlay')?.textContent ?? ''

check('detail panel renders no literal "null"', !/\bnull\b/.test(panelText()),
  `overlay text: ${JSON.stringify(panelText().slice(0, 120))}`)
check('detail panel shows the title',
  panelText().includes(getIndexTitle(0)),
  `expected ${JSON.stringify(getIndexTitle(0))}`)
check('detail panel offers a download', $('#overlay .downloads a') !== null)
check('detail panel has a bookmark control',
  [...$('#overlay').querySelectorAll('button')].some((b) => /Bookmark/i.test(b.textContent)))

// Check a second book too: `relatedList` is the other nullish path, and it only
// returns null when a book has no related works.
let checkedNoRelated = false
for (let ord = 1; ord < 40 && !checkedNoRelated; ord++) {
  window.location.hash = `#book/${ord}`
  await new Promise((r) => setTimeout(r, 90))
  if (!$('#overlay').querySelector('.related')) {
    check(`book ${ord} (no related works) renders no "null"`, !/\bnull\b/.test(panelText()),
      `overlay text: ${JSON.stringify(panelText().slice(0, 120))}`)
    checkedNoRelated = true
  }
}
if (!checkedNoRelated) console.log('OK   (every sampled book had related works; null path covered by book 0)')

check('no uncaught errors after interaction', errors.length === 0, errors.join('; '))

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`)
  process.exit(1)
}
console.log('\nOK: page boots and works in a DOM')
