/**
 * Application shell: search input, category facets, results, routing.
 *
 * State lives in the URL hash so a search is shareable and the back button
 * behaves. Everything is rendered from the index loaded once at startup.
 */
import { loadIndex, getIndex, search, count } from './search.mjs'
import { renderDetail } from './book.mjs'
import * as bookmarks from './bookmarks.mjs'
import * as offline from './offline.mjs'

const $ = (sel) => document.querySelector(sel)
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props)
  for (const child of [].concat(children)) if (child) node.append(child)
  return node
}

const state = {
  query: '',
  categories: new Set(),
  view: 'search', // 'search' | 'bookmarks' | 'offline'
}

/* ---------------------------------------------------------------- routing */

function readHash() {
  const hash = location.hash.slice(1)
  const [route, rest = ''] = [hash.split('?')[0], hash.split('?')[1]]
  const params = new URLSearchParams(rest)

  if (route.startsWith('book/')) return { book: Number(route.slice(5)) }

  state.query = params.get('q') ?? ''
  state.categories = new Set((params.get('c') ?? '').split(',').filter(Boolean).map(Number))
  state.view = route === 'bookmarks' || route === 'offline' ? route : 'search'
  return {}
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
  const [title, author] = getIndex().books[ord]
  const link = el('a', { href: `#book/${ord}`, className: 'result' }, [
    el('span', { className: 'result-title', textContent: title }),
    author ? el('span', { className: 'muted', textContent: author }) : null,
  ])
  return el('li', {}, link)
}

function renderResults() {
  const list = $('#results')
  list.textContent = ''

  let ordinals
  let total

  if (state.view === 'bookmarks') {
    ordinals = bookmarks.list()
    total = ordinals.length
  } else if (state.view === 'offline') {
    ordinals = offlineOrdinals
    total = ordinals.length
  } else {
    ordinals = search(state.query, { categories: state.categories, limit: 100 })
    total = count(state.query, { categories: state.categories })
  }

  if (ordinals.length === 0) {
    list.append(
      el('li', { className: 'empty' }, [
        state.view === 'bookmarks'
          ? 'No bookmarks yet. Open a book and choose Bookmark.'
          : state.view === 'offline'
            ? 'No books saved offline yet.'
            : 'No matches. Try fewer words, or clear the category filters.',
      ]),
    )
  } else {
    for (const ord of ordinals) list.append(resultRow(ord))
  }

  const shown = Math.min(ordinals.length, 100)
  $('#count').textContent =
    total === 0 ? '' : total > shown ? `${shown} of ${total} results` : `${total} result${total === 1 ? '' : 's'}`
}

function renderFacets() {
  const wrap = $('#facets')
  wrap.textContent = ''
  const index = getIndex()

  index.categories.forEach((name, id) => {
    const input = el('input', {
      type: 'checkbox',
      id: `cat-${id}`,
      checked: state.categories.has(id),
    })
    input.addEventListener('change', () => {
      if (input.checked) state.categories.add(id)
      else state.categories.delete(id)
      writeHash()
      renderResults()
    })
    wrap.append(el('li', {}, [input, el('label', { htmlFor: `cat-${id}`, textContent: name })]))
  })
}

let offlineOrdinals = []

async function refreshOfflineCount() {
  if (!offline.isSupported()) return
  const saved = await offline.all()
  offlineOrdinals = saved.map((s) => s.ord)
  const { usage } = await offline.usageEstimate()
  $('#offline-count').textContent = saved.length
    ? `${saved.length} offline · ${offline.fmt(usage)}`
    : ''
}

/* ---------------------------------------------------------------- detail  */

async function openBook(ord) {
  const overlay = $('#overlay')
  overlay.textContent = ''
  overlay.hidden = false
  overlay.append(el('p', { className: 'muted', textContent: 'Loading…' }))

  try {
    const panel = await renderDetail(ord, {
      onOpen: (next) => { location.hash = `#book/${next}` },
      onClose: () => history.back(),
    })
    overlay.textContent = ''
    overlay.append(panel)
    overlay.querySelector('.close')?.focus()
    await refreshOfflineCount()
  } catch (err) {
    overlay.textContent = ''
    overlay.append(el('p', { className: 'notice', textContent: err.message }))
  }
}

function closeBook() {
  $('#overlay').hidden = true
  $('#overlay').textContent = ''
}

/* ---------------------------------------------------------------- routes  */

function route() {
  const { book } = readHash()
  if (book !== undefined && Number.isFinite(book)) {
    openBook(book)
    return
  }
  closeBook()
  $('#q').value = state.query
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.setAttribute('aria-current', String(btn.dataset.view === state.view))
  }
  $('#facet-panel').hidden = state.view !== 'search'
  renderResults()
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
    clearTimeout(timer)
    // Debounce only the URL write; results repaint immediately because the
    // search itself is cheap enough not to need throttling.
    renderResults()
    timer = setTimeout(() => writeHash({ replace: true }), 150)
  })

  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view
      writeHash()
      route()
    })
  }

  $('#export').addEventListener('click', () => {
    const blob = new Blob([bookmarks.exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = el('a', { href: url, download: 'bookmarks.json' })
    document.body.append(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  })

  $('#import').addEventListener('change', async (e) => {
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
    if (e.key === 'Escape' && !$('#overlay').hidden) history.back()
  })

  window.addEventListener('hashchange', route)
  await refreshOfflineCount()
  route()
}

main()
