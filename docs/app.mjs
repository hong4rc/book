/**
 * Application shell: search input, category facets, results, routing.
 *
 * State lives in the URL hash so a search is shareable and the back button
 * behaves. Everything renders from the index loaded once at startup.
 *
 * Guiding rule throughout: search and download must keep working even when
 * storage is unavailable. Bookmarks and offline copies are enhancements, and
 * their failures are contained rather than allowed to reach the page.
 */
import { el, appendAll } from './dom.mjs'
import { coverSvg } from './cover.mjs'
import { loadIndex, getIndex, search } from './search.mjs'
import { renderDetail } from './book.mjs'
import * as bookmarks from './bookmarks.mjs'
import * as offline from './offline.mjs'

const PAGE = 60   // rows appended per 'load more'

const $ = (sel) => document.querySelector(sel)

const state = {
  query: '',
  categories: new Set(),
  view: 'search', // 'search' | 'bookmarks' | 'offline'
}

let offlineOrdinals = []
let openToken = 0          // guards against a slow shard overwriting a newer panel
let inAppNavigations = 0   // distinguishes a deep link from in-app navigation
let lastFocused = null

/* ---------------------------------------------------------------- routing */

/**
 * Parse the hash into `state`, returning the requested book ordinal if any.
 * State is ALWAYS refreshed, including on a book route, so that deep-linking
 * to a book still renders the catalogue behind the overlay.
 */
function readHash() {
  const raw = location.hash.slice(1)
  const [route, rest = ''] = [raw.split('?')[0], raw.split('?')[1]]
  const params = new URLSearchParams(rest)

  let book
  if (route.startsWith('book/')) {
    const ord = Number(route.slice(5))
    // Guard the empty and non-numeric cases: Number('') is 0, which would
    // silently open the first book in the catalogue.
    if (route.length > 5 && Number.isInteger(ord) && ord >= 0) book = ord
  } else {
    state.view = route === 'bookmarks' || route === 'offline' ? route : 'search'
    state.query = params.get('q') ?? ''
    state.categories = new Set((params.get('c') ?? '').split(',').filter(Boolean).map(Number))
  }
  return book
}

function writeHash({ replace = false } = {}) {
  const params = new URLSearchParams()
  if (state.query) params.set('q', state.query)
  if (state.categories.size) params.set('c', [...state.categories].join(','))
  const query = params.toString()
  const hash = `#${state.view === 'search' ? '' : state.view}${query ? `?${query}` : ''}`
  if (replace) history.replaceState(null, '', hash || '#')
  else location.hash = hash
}

/* ---------------------------------------------------------------- render  */

function resultRow(ord) {
  const index = getIndex()
  const entry = index.books[ord]
  if (!entry) return null // stale bookmark, or an id from a different catalogue
  const [title, author, , catIds] = entry
  const category = index.categories[catIds?.[0]] ?? 'Khác'

  const art = el('div', { className: 'cover-wrap' })
  // Trusted input: coverSvg escapes its own text and the values come from our
  // own index, never from remote HTML.
  art.innerHTML = coverSvg({ title, author, category })

  return el('li', { className: 'card' }, el('a', { href: `#book/${ord}`, className: 'card-link' }, [
    art,
    el('div', { className: 'card-body' }, [
      el('span', { className: 'card-title', textContent: title }),
      el('span', { className: 'card-author', textContent: author ?? 'Khuyết danh' }),
    ]),
  ]))
}

let shown = []          // ordinals currently rendered
let matched = []        // every ordinal matching the current query/filters

/** Recompute the match set. Called when query, facets, or view change. */
function recomputeMatches() {
  if (state.view === 'bookmarks') matched = bookmarks.list()
  else if (state.view === 'offline') matched = offlineOrdinals
  else matched = search(state.query, { categories: state.categories, limit: Infinity }).ordinals
  shown = []
}

/**
 * Append the next page.
 *
 * Appends rather than re-rendering: the earlier design capped every list at 100
 * and left 6,382 works unreachable by browsing. There is deliberately no
 * windowed row-trimming — dropping rows off the top to bound the DOM
 * reintroduces the scroll-anchoring problem it was meant to avoid.
 */
function renderMore(count = PAGE) {
  const list = $('#results')
  const next = matched.slice(shown.length, shown.length + count)
  for (const ord of next) {
    const row = resultRow(ord)
    if (row) list.append(row)
  }
  shown = matched.slice(0, shown.length + next.length)
  paintCount()
}

function paintCount() {
  const total = matched.length
  $('#count').textContent = total === 0 ? '' : `${shown.length} / ${total.toLocaleString()}`
  const more = total - shown.length
  const btn = $('#more')
  btn.hidden = more <= 0
  btn.textContent = more > 0 ? `Xem thêm (còn ${more.toLocaleString()})` : ''
}

function renderResults() {
  const list = $('#results')
  list.textContent = ''
  recomputeMatches()

  if (matched.length === 0) {
    list.append(el('li', { className: 'empty' }, [
      state.view === 'bookmarks'
        ? 'Chưa có sách nào được đánh dấu.'
        : state.view === 'offline'
          ? 'Chưa lưu sách nào để đọc ngoại tuyến.'
          : 'Không tìm thấy. Thử ít từ hơn, hoặc bỏ bớt bộ lọc.',
    ]))
    paintCount()
    return
  }
  renderMore()
}

function renderFacets() {
  const wrap = $('#facets')
  wrap.textContent = ''

  getIndex().categories.forEach((name, id) => {
    const input = el('input', {
      type: 'checkbox',
      id: `cat-${id}`,
      checked: state.categories.has(id),
    })
    input.addEventListener('change', () => {
      if (input.checked) state.categories.add(id)
      else state.categories.delete(id)
      writeHash({ replace: true }) // replace: avoid a history entry per checkbox
      renderResults()
    })
    wrap.append(el('li', {}, [input, el('label', { htmlFor: `cat-${id}`, textContent: name })]))
  })
}

/** Reflect `state` back onto the checkboxes after back/forward navigation. */
function syncFacets() {
  for (const input of document.querySelectorAll('#facets input[type=checkbox]')) {
    input.checked = state.categories.has(Number(input.id.slice(4)))
  }
}

async function refreshOfflineCount() {
  if (!offline.isSupported()) return
  // indexedDB can exist yet be unusable. This is a decoration; never let it
  // reach the caller, which would abort startup or wipe an open panel.
  try {
    const saved = await offline.all()
    offlineOrdinals = saved.map((s) => s.ord)
    const { usage } = await offline.usageEstimate()
    $('#offline-count').textContent = saved.length
      ? `${saved.length} offline · ${offline.fmt(usage)}`
      : ''
  } catch {
    offlineOrdinals = []
    $('#offline-count').textContent = ''
  }
}

/* ---------------------------------------------------------------- detail  */

function setBackgroundInert(on) {
  for (const sel of ['header.topbar', 'main.layout', 'footer.foot']) {
    const node = $(sel)
    if (node) node.inert = on
  }
}

async function openBook(ord) {
  const token = ++openToken
  const overlay = $('#overlay')
  if (overlay.hidden) lastFocused = document.activeElement

  overlay.textContent = ''
  overlay.hidden = false
  setBackgroundInert(true)
  overlay.append(el('p', { className: 'muted', textContent: 'Loading…' }))

  try {
    const panel = await renderDetail(ord, {
      onOpen: (next) => { location.hash = `#book/${next}` },
      onClose: closeDetail,
      onOfflineChange: () => { refreshOfflineCount() },
    })
    if (token !== openToken) return // a newer request won; discard this one
    overlay.textContent = ''
    overlay.append(panel)
    overlay.querySelector('.close')?.focus()
  } catch (err) {
    if (token !== openToken) return
    overlay.textContent = ''
    overlay.append(el('p', { className: 'notice', textContent: err.message }))
  }
  // Outside the try: a storage hiccup here must not replace the panel the user
  // is already looking at with an error string.
  refreshOfflineCount()
}

function closeBook() {
  const overlay = $('#overlay')
  if (overlay.hidden) return
  overlay.hidden = true
  overlay.textContent = ''
  setBackgroundInert(false)
  if (lastFocused?.isConnected) lastFocused.focus()
  lastFocused = null
}

/**
 * Close the detail view. `history.back()` is only safe once the user has
 * navigated within the app; on a shared #book/N link it would leave the site.
 */
function closeDetail() {
  openToken++ // cancel any in-flight open
  if (inAppNavigations > 0) history.back()
  else {
    history.replaceState(null, '', '#')
    route()
  }
}

/* ---------------------------------------------------------------- routes  */

function route() {
  const book = readHash()

  // Always render the catalogue first, so a deep-linked book has the list
  // behind it rather than an empty page.
  $('#q').value = state.query
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.dataset.view === state.view
      ? btn.setAttribute('aria-current', 'true')
      : btn.removeAttribute('aria-current')
  }
  $('#facets-section').hidden = state.view !== 'search'
  syncFacets()
  renderResults()

  if (book !== undefined) openBook(book)
  else closeBook()
}

/* ---------------------------------------------------------------- start   */

async function main() {
  try {
    await loadIndex()
  } catch (err) {
    $('#results').append(el('li', { className: 'notice', textContent: err.message }))
    return
  }

  const index = getIndex()
  $('#total').textContent = `${index.total.toLocaleString()} books`
  renderFacets()

  let timer
  $('#q').addEventListener('input', (e) => {
    state.query = e.target.value
    renderResults()
    clearTimeout(timer)
    // Only the URL write is debounced; the scan itself is cheap enough to run
    // on every keystroke, and results should never lag behind the input.
    timer = setTimeout(() => writeHash({ replace: true }), 150)
  })

  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view
      // replace + explicit route(), rather than assigning location.hash, which
      // would fire hashchange and run the whole route a second time.
      writeHash({ replace: true })
      route()
    })
  }

  $('#more').addEventListener('click', () => {
    renderMore()
    // Keep focus on the button so repeated keyboard activation works; it moves
    // down the page as rows are appended, which is the expected behaviour.
    $('#more').focus()
  })

  $('#export').addEventListener('click', () => {
    const blob = new Blob([bookmarks.exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = el('a', { href: url, download: 'bookmarks.json' })
    document.body.append(a)
    a.click()
    a.remove()
    // Deferred: revoking in the same task cancels the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  })

  $('#import').addEventListener('click', () => $('#import-file').click())

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const added = await file.text().then(bookmarks.importJson)
      $('#count').textContent = `Imported ${added} bookmark${added === 1 ? '' : 's'}`
      renderResults()
    } catch (err) {
      $('#count').textContent = err.message
    }
    e.target.value = ''
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#overlay').hidden) closeDetail()
  })

  window.addEventListener('hashchange', () => {
    inAppNavigations++
    route()
  })

  await refreshOfflineCount()
  route()
}

// Nothing in main() may take the page down with it.
main().catch((err) => {
  console.error(err)
  $('#count').textContent = 'Something went wrong loading the catalogue.'
})
