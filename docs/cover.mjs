/**
 * Deterministic typographic book covers, generated as inline SVG.
 *
 * Real cover art effectively does not exist for this corpus: measured 0.3%
 * coverage (1 of 300 sampled works) plus 38 thumbnails catalogue-wide. So a
 * "show the cover" feature has to make one, not fetch one.
 *
 * Generated rather than fetched means: 100% coverage, zero bytes on the wire,
 * zero repo growth, no third-party request, and it works offline. The cost is
 * that it must look deliberate rather than like a missing image — hence
 * typography as the design, not a grey placeholder box.
 *
 * Deterministic: the same book always yields the same cover, so a reader
 * recognises it on return and nothing shifts between renders.
 */

/** FNV-1a. Small, fast, and stable across runs — Math.random would not be. */
function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * Category sets the hue family so a shelf reads as grouped; the title hash
 * varies tone within it so neighbours are still distinguishable.
 */
const CATEGORY_HUE = {
  'Thơ ca': 348,      // wine
  'Truyện': 28,       // amber
  'Pháp luật': 210,   // slate blue
  'Lịch sử': 18,      // rust
  'Tôn giáo': 268,    // violet
  'Báo chí': 192,     // teal
  'Văn kiện': 232,    // indigo
  'Diễn văn': 4,      // brick
  'Nghiên cứu': 152,  // green
  'Khác': 40,         // sand
}

/** Break a title into lines that fit, without splitting words where avoidable. */
function wrap(text, maxChars, maxLines) {
  const words = text.split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (next.length > maxChars && line) {
      lines.push(line)
      line = w
      if (lines.length === maxLines) break
    } else {
      line = next
    }
  }
  if (lines.length < maxLines && line) lines.push(line)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1]
    lines[maxLines - 1] = last.length > 3 ? `${last.slice(0, -1)}…` : last
  }
  return lines
}

const escapeXml = (s) =>
  String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]))

/**
 * @param {{title: string, author?: string|null, category?: string}} book
 * @returns {string} an <svg> element, ready to inline
 */
export function coverSvg({ title, author, category }) {
  const h = hash(title)
  const hue = CATEGORY_HUE[category] ?? CATEGORY_HUE['Khác']
  // Narrow ranges keep every cover in the same editorial family rather than
  // producing a rainbow of unrelated cards.
  const sat = 12 + (h % 10)
  const light = 90 + ((h >> 4) % 5)
  const inkLight = 22 + ((h >> 8) % 8)

  const paper = `hsl(${hue} ${sat}% ${light}%)`
  const ink = `hsl(${hue} 45% ${inkLight}%)`
  const rule = `hsl(${hue} 30% ${inkLight + 45}%)`

  const lines = wrap(title, 15, 4)
  const fontSize = lines.length > 3 ? 12.5 : lines.length > 2 ? 14 : 16
  const startY = 52 - (lines.length - 1) * (fontSize * 0.62)

  const titleLines = lines
    .map((l, i) => `<text x="50" y="${(startY + i * fontSize * 1.24).toFixed(1)}" font-size="${fontSize}" fill="${ink}" text-anchor="middle" font-family="Georgia,'Times New Roman',serif">${escapeXml(l)}</text>`)
    .join('')

  const authorLine = author
    ? `<text x="50" y="118" font-size="8" fill="${ink}" opacity=".72" text-anchor="middle" font-family="Georgia,'Times New Roman',serif">${escapeXml(wrap(author, 24, 1)[0] ?? '')}</text>`
    : ''

  // aria-hidden: the surrounding link already announces title and author, so a
  // screen reader repeating them here would be noise.
  return `<svg class="cover" viewBox="0 0 100 140" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
<rect width="100" height="140" fill="${paper}"/>
<rect x="0" y="0" width="100" height="3.5" fill="${ink}" opacity=".85"/>
<line x1="14" y1="${(startY - fontSize * 0.95).toFixed(1)}" x2="86" y2="${(startY - fontSize * 0.95).toFixed(1)}" stroke="${rule}" stroke-width=".6"/>
${titleLines}
<line x1="30" y1="108" x2="70" y2="108" stroke="${rule}" stroke-width=".6"/>
${authorLine}
</svg>`
}
