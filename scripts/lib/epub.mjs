/**
 * Minimal EPUB 3 assembly.
 *
 * No embedded fonts. The upstream ws-export EPUBs were ~4.35MB each, of which
 * ~7.7MB of 8.2MB uncompressed was four repeated FreeSerif faces — that single
 * fact is why mirroring the corpus once looked like 28GB and is really ~55-74MB.
 * Readers use their own fonts; Vietnamese renders fine on every modern device.
 */
import { zipSync, strToU8 } from 'fflate'
import { esc } from './wikitext-to-xhtml.mjs'

const XHTML_OPEN =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE html>\n' +
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="vi" xml:lang="vi">'

const CSS = `body{margin:1em;line-height:1.6;font-family:serif}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.2em 0 .5em}
p{margin:.6em 0;text-align:left}
p.verse{white-space:normal;margin:.9em 0;padding-left:1em}
blockquote{margin:.9em 1.2em;font-style:italic}
.meta{color:#555;font-size:.9em}
.licence{margin-top:2em;padding-top:.6em;border-top:1px solid #ccc;font-size:.85em;color:#555}
`

const page = (title, body) =>
  `${XHTML_OPEN}\n<head><meta charset="utf-8"/><title>${esc(title)}</title>` +
  `<link rel="stylesheet" type="text/css" href="style.css"/></head>\n<body>\n${body}\n</body>\n</html>\n`

/**
 * Title page carrying attribution and licence.
 *
 * Generated per work rather than authored once, so a CC BY-SA work can never
 * ship without its required attribution because someone forgot that one file.
 */
function titlePage({ title, author, sourceUrl, license, year }) {
  const licenceText =
    license === 'CC-BY-SA-4.0'
      ? 'Giấy phép: Creative Commons Ghi công–Chia sẻ tương tự 4.0 (CC BY-SA 4.0). ' +
        'Tác phẩm phái sinh phải giữ nguyên giấy phép này.'
      : 'Giấy phép: Phạm vi công cộng (Public Domain).'

  return page(title, [
    `<h1>${esc(title)}</h1>`,
    author ? `<p class="meta">${esc(author)}</p>` : '',
    year ? `<p class="meta">${esc(year)}</p>` : '',
    '<div class="licence">',
    `<p>Nguồn: <a href="${esc(sourceUrl)}">Vietnamese Wikisource</a></p>`,
    `<p>${esc(licenceText)}</p>`,
    '</div>',
  ].filter(Boolean).join('\n'))
}

const opf = ({ id, title, author, language, sourceUrl, license, modified }, chapters) => {
  const items = chapters.map((c, i) =>
    `<item id="c${i}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n    ')
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('\n    ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${esc(id)}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    <dc:language>${esc(language)}</dc:language>
    ${author ? `<dc:creator>${esc(author)}</dc:creator>` : ''}
    <dc:source>${esc(sourceUrl)}</dc:source>
    <dc:rights>${esc(license)}</dc:rights>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${items}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>
`
}

const nav = (title, chapters) =>
  page(title, '<nav epub:type="toc" id="toc"><h1>Mục lục</h1><ol>' +
    chapters.map((c) => `<li><a href="${c.file}">${esc(c.title)}</a></li>`).join('') +
    '</ol></nav>')

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`

/**
 * Build an EPUB.
 *
 * @param {object} meta  id, title, author, language, sourceUrl, license, year
 * @param {Array<{title: string, xhtml: string}>} sections  body fragments, in reading order
 * @returns {Uint8Array}
 */
export function buildEpub(meta, sections) {
  const chapters = [
    { file: 'title.xhtml', title: meta.title, content: titlePage(meta) },
    ...sections.map((s, i) => ({
      file: `c${i + 1}.xhtml`,
      title: s.title,
      content: page(s.title, s.xhtml),
    })),
  ]

  // Insertion order is the zip order. `mimetype` MUST be entry zero and stored
  // uncompressed per the OCF spec; getting this wrong produces a file readers
  // reject with no useful error, so it goes in first and is asserted below.
  const files = {}
  files['mimetype'] = [strToU8('application/epub+zip'), { level: 0 }]
  files['META-INF/container.xml'] = strToU8(CONTAINER)
  files['OPS/style.css'] = strToU8(CSS)
  files['OPS/nav.xhtml'] = strToU8(nav(meta.title, chapters))
  files['OPS/content.opf'] = strToU8(opf(meta, chapters))
  for (const c of chapters) files[`OPS/${c.file}`] = strToU8(c.content)

  const bytes = zipSync(files, { level: 9 })
  assertOcf(bytes)
  return bytes
}

/**
 * Verify OCF structure by reading the raw local file header.
 *
 * Checked on every generated file rather than spot-checked: a malformed
 * `mimetype` entry is invisible until a reader refuses the book, and by then
 * thousands of files would already be committed.
 */
export function assertOcf(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('not a zip: bad local file header')
  const method = dv.getUint16(8, true)
  const nameLen = dv.getUint16(26, true)
  const extraLen = dv.getUint16(28, true)
  const name = new TextDecoder().decode(bytes.subarray(30, 30 + nameLen))
  if (name !== 'mimetype') throw new Error(`first zip entry is '${name}', must be 'mimetype'`)
  if (method !== 0) throw new Error(`mimetype is compressed (method ${method}), must be stored`)
  if (extraLen !== 0) throw new Error('mimetype entry has an extra field, must have none')
  const payload = new TextDecoder().decode(bytes.subarray(30 + nameLen, 30 + nameLen + 20))
  if (payload !== 'application/epub+zip') throw new Error(`mimetype payload is '${payload}'`)
  return true
}
