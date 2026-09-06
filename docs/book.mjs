/**
 * Book detail: shard loading, download links, related works.
 *
 * Detail records live in shards so the initial page load stays small. A shard
 * is fetched on first open and cached for the session; related books are read
 * from the record itself, precomputed at build time, so showing them costs no
 * extra request.
 */
import { el, appendAll } from './dom.mjs'
import { getIndex } from './search.mjs'
import * as bookmarks from './bookmarks.mjs'
import * as offline from './offline.mjs'

const shardCache = new Map()

async function loadShard(n) {
  if (shardCache.has(n)) return shardCache.get(n)
  const promise = fetch(`./data/shards/${n}.json`).then((res) => {
    if (!res.ok) throw new Error(`could not load shard ${n} (HTTP ${res.status})`)
    return res.json()
  })
  // Evict on failure. Caching a rejected promise would make one flaky moment
  // permanently break all 200 books in that shard for the rest of the session,
  // with retries failing instantly and no request ever being made again.
  shardCache.set(
    n,
    promise.catch((err) => {
      shardCache.delete(n)
      throw err
    }),
  )
  return shardCache.get(n)
}

export async function getBook(ord) {
  const { shardSize } = getIndex()
  const shard = await loadShard(Math.floor(ord / shardSize))
  const record = shard[ord]
  if (!record) throw new Error(`book ${ord} not found`)
  return record
}

/** Only ever emit links the browser will navigate, never javascript: or data:. */
const safeUrl = (url) => {
  try {
    return new URL(url, location.href).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function downloadRow(book) {
  const row = el('div', { className: 'downloads' })
  for (const d of book.downloads) {
    if (!safeUrl(d.url)) continue
    row.append(
      el('a', {
        className: 'btn' + (d.format === 'epub' ? ' btn-primary' : ''),
        href: d.url,
        rel: 'noopener',
        textContent: d.format.toUpperCase(),
        title:
          d.format === 'epub'
            ? 'Download EPUB (generated on demand; may take a few seconds)'
            : `Download ${d.format.toUpperCase()}`,
      }),
    )
  }
  if (!safeUrl(book.sourceUrl)) return row
  row.append(
    el('a', {
      className: 'btn btn-quiet',
      href: book.sourceUrl,
      rel: 'noopener',
      target: '_blank',
      textContent: 'Wikisource',
      title: 'Open the source page (also a fallback if downloads are slow)',
    }),
  )
  return row
}

async function offlineControls(ord, book, onChange) {
  const wrap = el('div', { className: 'offline' })
  if (!offline.isSupported()) return wrap

  const status = el('span', { className: 'muted' })
  const button = el('button', { className: 'btn', type: 'button' })

  const epub = book.downloads.find((d) => d.format === 'epub')
  if (!epub) return wrap

  async function render() {
    const saved = await offline.get(ord)
    if (saved) {
      button.textContent = 'Remove offline copy'
      const savings = saved.stripped
        ? ` (was ${offline.fmt(saved.originalSize)}, fonts removed)`
        : ''
      status.textContent = `Saved offline: ${offline.fmt(saved.size)}${savings}`
    } else {
      button.textContent = 'Save offline'
      status.textContent = ''
    }
  }

  button.addEventListener('click', async () => {
    button.disabled = true
    try {
      if (await offline.has(ord)) {
        await offline.remove(ord)
      } else {
        status.textContent = 'Downloading…'
        await offline.requestPersistence()
        await offline.save(ord, { title: book.title, url: epub.url, strip: true })
      }
      await render()
      onChange?.() // keep the header count and Offline view in step
    } catch (err) {
      status.textContent = err.message
    } finally {
      button.disabled = false
    }
  })

  // IndexedDB can be present yet unusable (private windows, partitioned
  // storage, SecurityError). Offline saving is a bonus; losing it must never
  // cost the user the title, metadata and download links on this panel.
  try {
    await render()
  } catch {
    return el('div', { className: 'offline' })
  }
  wrap.append(button, status)
  return wrap
}

function relatedList(book, onOpen) {
  if (!book.related?.length) return null
  const index = getIndex()
  const list = el('ul', { className: 'related' })

  for (const ord of book.related) {
    const entry = index.books[ord]
    if (!entry) continue
    const [title, author] = entry
    const link = el('a', { href: `#book/${ord}`, textContent: title })
    link.addEventListener('click', (e) => {
      e.preventDefault()
      onOpen(ord)
    })
    list.append(el('li', {}, [link, author ? el('span', { className: 'muted', textContent: ` — ${author}` }) : null]))
  }
  return list.children.length ? el('section', {}, [el('h3', { textContent: 'Related books' }), list]) : null
}

export async function renderDetail(ord, { onOpen, onClose, onOfflineChange }) {
  const book = await getBook(ord)
  const panel = el('div', { className: 'detail' })

  const close = el('button', { className: 'close', type: 'button', textContent: '×', title: 'Close' })
  close.addEventListener('click', onClose)

  const bookmark = el('button', { className: 'btn', type: 'button' })
  const paintBookmark = () => {
    bookmark.textContent = bookmarks.isBookmarked(ord) ? '★ Bookmarked' : '☆ Bookmark'
  }
  bookmark.addEventListener('click', () => {
    bookmarks.toggle(ord, book.title)
    paintBookmark()
  })
  paintBookmark()

  const meta = []
  if (book.author) meta.push(book.author)
  if (book.chapters > 0) meta.push(`${book.chapters} chapters`)
  if (book.quality) meta.push(`proofread ${book.quality}`)
  meta.push(book.license)

  appendAll(
    panel,
    close,
    el('h2', { textContent: book.title }),
    el('p', { className: 'muted', textContent: meta.join(' · ') }),
    book.isVersionsPage
      ? el('p', { className: 'notice', textContent: 'This is a versions page listing several editions of the work.' })
      : null,
    el('div', { className: 'chips' }, book.categories.map((c) => el('span', { className: 'chip', textContent: c }))),
    downloadRow(book),
    // The bookmark button sits with the other actions. It was previously
    // constructed and wired but never appended, so bookmarking silently did
    // nothing at all.
    el('div', { className: 'actions' }, [bookmark]),
    await offlineControls(ord, book, onOfflineChange),
    relatedList(book, onOpen),
  )
  return panel
}
