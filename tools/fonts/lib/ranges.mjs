// Conversions between CSS `unicode-range` syntax and plain codepoint sets.
//
// Spec: https://drafts.csswg.org/css-fonts-4/#unicode-range-desc

/**
 * Parse a CSS unicode-range value into inclusive [start, end] pairs.
 * Supports `U+0590`, `U+0590-05FF` and the wildcard form `U+05??`.
 * @param {string} value
 * @returns {[number, number][]}
 */
export function parseUnicodeRange(value) {
  const ranges = []
  for (const raw of value.split(',')) {
    const token = raw.trim()
    if (!token) continue

    const match = /^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(token)
    if (!match) throw new Error(`cannot parse unicode-range token ${JSON.stringify(token)}`)

    const [, first, second] = match
    if (first.includes('?')) {
      if (second !== undefined) throw new Error(`wildcard range cannot have an end: ${token}`)
      ranges.push([
        parseInt(first.replace(/\?/g, '0'), 16),
        parseInt(first.replace(/\?/g, 'f'), 16),
      ])
      continue
    }

    const start = parseInt(first, 16)
    const end = second === undefined ? start : parseInt(second, 16)
    if (end < start) throw new Error(`inverted unicode-range token: ${token}`)
    ranges.push([start, end])
  }
  if (ranges.length === 0) throw new Error('empty unicode-range')
  return ranges
}

const hex = (cp) => cp.toString(16).toUpperCase().padStart(4, '0')

/**
 * Render inclusive [start, end] pairs as a CSS unicode-range value.
 * @param {[number, number][]} ranges
 * @returns {string}
 */
export function formatUnicodeRange(ranges) {
  return ranges
    .map(([start, end]) => (start === end ? `U+${hex(start)}` : `U+${hex(start)}-${hex(end)}`))
    .join(', ')
}

/**
 * Collapse a set of codepoints into sorted, merged inclusive ranges.
 * @param {Iterable<number>} codepoints
 * @returns {[number, number][]}
 */
export function toRanges(codepoints) {
  const sorted = [...codepoints].sort((a, b) => a - b)
  const ranges = []
  for (const cp of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && cp === last[1] + 1) last[1] = cp
    else if (!last || cp !== last[1]) ranges.push([cp, cp])
  }
  return ranges
}

/**
 * @param {[number, number][]} ranges
 * @returns {Set<number>}
 */
export function toSet(ranges) {
  const set = new Set()
  for (const [start, end] of ranges) {
    for (let cp = start; cp <= end; cp++) set.add(cp)
  }
  return set
}

/**
 * Restrict `ranges` to codepoints the font actually has, then re-merge.
 *
 * Google's declared ranges are a superset of any single font's coverage (they describe the subset
 * family, not the file), so intersecting keeps the browser from downloading a face for a codepoint
 * it cannot render — which is exactly the wasted 112 KB the old 'Noto Sans Greek' rule caused.
 *
 * @param {[number, number][]} ranges
 * @param {Set<number>} codepoints
 * @returns {[number, number][]}
 */
export function intersect(ranges, codepoints) {
  const kept = []
  for (const [start, end] of ranges) {
    for (let cp = start; cp <= end; cp++) {
      if (codepoints.has(cp)) kept.push(cp)
    }
  }
  return toRanges(kept)
}

/**
 * @param {[number, number][]} ranges
 * @returns {number} total codepoints spanned
 */
export function countRanges(ranges) {
  return ranges.reduce((total, [start, end]) => total + (end - start + 1), 0)
}
