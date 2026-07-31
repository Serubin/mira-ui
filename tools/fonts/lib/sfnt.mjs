// Minimal WOFF2 / SFNT reader.
//
// We only need enough of the container format to pull `cmap` (and peek at `COLR`) out of a font
// file, so that the build can derive each face's real codepoint coverage instead of trusting a
// filename. That check is the whole point: the hand-written CSS this replaced shipped
// `NotoSansGK-VF.woff2` as 'Noto Sans Greek' when the file actually contains Gurmukhi.
//
// Refs: https://www.w3.org/TR/WOFF2/ and
// https://learn.microsoft.com/en-us/typography/opentype/spec/otff

import { brotliDecompressSync } from 'node:zlib'

// WOFF2 known-table index (spec Table 3). Index 63 means "tag follows inline".
const KNOWN_TAGS = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
  'EBSC',
  'JSTF',
  'MATH',
  'CBDT',
  'CBLC',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'acnt',
  'avar',
  'bdat',
  'bloc',
  'bsln',
  'cvar',
  'fdsc',
  'feat',
  'fmtx',
  'fvar',
  'gvar',
  'hsty',
  'just',
  'lcar',
  'mort',
  'morx',
  'opbd',
  'prop',
  'trak',
  'Zapf',
  'Silf',
  'Glat',
  'Gloc',
  'Feat',
  'Sill',
]

const WOFF2_SIGNATURE = 0x774f4632 // 'wOF2'
const TTCF_FLAVOR = 0x74746366 // 'ttcf'
const MAX_CODEPOINTS = 200_000 // sanity bound; largest real font is ~50k

function readUIntBase128(buf, pos) {
  let value = 0
  for (let i = 0; i < 5; i++) {
    const byte = buf[pos++]
    if (byte === undefined) throw new Error('truncated UIntBase128')
    // spec forbids leading zeroes and values that overflow uint32
    if (i === 0 && byte === 0x80) throw new Error('UIntBase128 has leading zero')
    value = value * 128 + (byte & 0x7f)
    if ((byte & 0x80) === 0) {
      if (value > 0xffffffff) throw new Error('UIntBase128 overflow')
      return [value, pos]
    }
  }
  throw new Error('UIntBase128 longer than 5 bytes')
}

function isTransformed(tag, transformVersion) {
  // glyf/loca use 0 to mean "transformed"; every other table uses non-zero.
  return tag === 'glyf' || tag === 'loca' ? transformVersion === 0 : transformVersion !== 0
}

function readWoff2Tables(buf) {
  const numTables = buf.readUInt16BE(12)
  const totalCompressedSize = buf.readUInt32BE(20)
  if (buf.readUInt32BE(4) === TTCF_FLAVOR) throw new Error('WOFF2 font collections not supported')

  let pos = 48 // fixed WOFF2 header length
  const directory = []
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++]
    const tagIndex = flags & 0x3f
    const transformVersion = (flags >> 6) & 0x03

    let tag
    if (tagIndex === 63) {
      tag = buf.toString('latin1', pos, pos + 4)
      pos += 4
    } else {
      tag = KNOWN_TAGS[tagIndex]
      if (tag === undefined) throw new Error(`unknown WOFF2 table index ${tagIndex}`)
    }

    let originalLength
    ;[originalLength, pos] = readUIntBase128(buf, pos)

    // A transformed table stores its transformed length; that is its size in the stream.
    let streamLength = originalLength
    if (isTransformed(tag, transformVersion)) {
      ;[streamLength, pos] = readUIntBase128(buf, pos)
    }
    directory.push({ tag, streamLength })
  }

  const stream = brotliDecompressSync(buf.subarray(pos, pos + totalCompressedSize))

  const tables = new Map()
  let offset = 0
  for (const { tag, streamLength } of directory) {
    tables.set(tag, stream.subarray(offset, offset + streamLength))
    offset += streamLength
  }
  return tables
}

function readSfntTables(buf) {
  const numTables = buf.readUInt16BE(4)
  const tables = new Map()
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16
    const tag = buf.toString('latin1', record, record + 4)
    const offset = buf.readUInt32BE(record + 8)
    const length = buf.readUInt32BE(record + 12)
    tables.set(tag, buf.subarray(offset, offset + length))
  }
  return tables
}

/**
 * Read a font's table directory.
 * @param {Buffer} buf a .woff2, .ttf or .otf file
 * @returns {Map<string, Buffer>} table tag -> table bytes
 */
export function readTables(buf) {
  if (buf.length < 48) throw new Error('file too short to be a font')
  return buf.readUInt32BE(0) === WOFF2_SIGNATURE ? readWoff2Tables(buf) : readSfntTables(buf)
}

function readCmapSubtable(cmap, offset, out) {
  const format = cmap.readUInt16BE(offset)

  if (format === 4) {
    const segCountX2 = cmap.readUInt16BE(offset + 6)
    const endBase = offset + 14
    const startBase = endBase + segCountX2 + 2 // +2 skips reservedPad
    for (let s = 0; s < segCountX2 / 2; s++) {
      const end = cmap.readUInt16BE(endBase + s * 2)
      const start = cmap.readUInt16BE(startBase + s * 2)
      // 0xFFFF..0xFFFF is the required terminator segment, not real coverage
      if (start === 0xffff) continue
      for (let cp = start; cp <= end; cp++) out.add(cp)
    }
    return
  }

  if (format === 6) {
    const first = cmap.readUInt16BE(offset + 6)
    const count = cmap.readUInt16BE(offset + 8)
    for (let i = 0; i < count; i++) out.add(first + i)
    return
  }

  if (format === 12 || format === 13) {
    const numGroups = cmap.readUInt32BE(offset + 12)
    for (let g = 0; g < numGroups; g++) {
      const group = offset + 16 + g * 12
      const start = cmap.readUInt32BE(group)
      const end = cmap.readUInt32BE(group + 4)
      if (end < start) throw new Error(`cmap format ${format} group ${g} has end < start`)
      for (let cp = start; cp <= end; cp++) {
        out.add(cp)
        if (out.size > MAX_CODEPOINTS) throw new Error('cmap coverage implausibly large')
      }
    }
    return
  }

  // formats 0/2/8/10 are legacy or vanishingly rare; ignoring them is safe for Noto/Inter but
  // must not be silent, or a parser gap would look like missing coverage.
  throw new Error(`unsupported cmap subtable format ${format}`)
}

/**
 * Every Unicode codepoint the font claims to support.
 * @param {Buffer} buf a .woff2, .ttf or .otf file
 * @returns {Set<number>}
 */
export function readCodepoints(buf) {
  const cmap = readTables(buf).get('cmap')
  if (!cmap) throw new Error('font has no cmap table')

  const numSubtables = cmap.readUInt16BE(2)
  const codepoints = new Set()
  let read = 0
  for (let i = 0; i < numSubtables; i++) {
    const record = 4 + i * 8
    const platformId = cmap.readUInt16BE(record)
    const encodingId = cmap.readUInt16BE(record + 2)
    const offset = cmap.readUInt32BE(record + 4)

    // Unicode character maps only:
    //   (0, 3) BMP, (0, 4) full repertoire, (3, 1) BMP, (3, 10) full repertoire
    // Deliberately excluded: (1, 0) Mac Roman, which is codepage-indexed rather than Unicode, and
    // (0, 5) Unicode variation sequences -- a format 14 subtable that maps selector *sequences*,
    // not base codepoints, so counting it as coverage would be wrong.
    const isUnicodeCmap =
      (platformId === 0 && (encodingId === 3 || encodingId === 4)) ||
      (platformId === 3 && (encodingId === 1 || encodingId === 10))
    if (!isUnicodeCmap) continue

    readCmapSubtable(cmap, offset, codepoints)
    read++
  }
  if (read === 0) throw new Error('font has no Unicode cmap subtable')
  return codepoints
}

/**
 * Read strings out of the `name` table.
 *
 * Used to build the OFL attribution notice from what each font file actually declares, rather than
 * from a hand-kept list that can drift out of date.
 *
 * @param {Buffer} buf
 * @returns {Map<number, string>} name ID -> string (see the OpenType `name` table spec: 0 is the
 *   copyright notice, 1 the family, 7 the trademark, 13 the license, 14 the license URL)
 */
export function readNames(buf) {
  const table = readTables(buf).get('name')
  if (!table) throw new Error('font has no name table')

  const count = table.readUInt16BE(2)
  const storageOffset = table.readUInt16BE(4)
  const names = new Map()

  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12
    const platformId = table.readUInt16BE(record)
    const encodingId = table.readUInt16BE(record + 2)
    const nameId = table.readUInt16BE(record + 6)
    const length = table.readUInt16BE(record + 8)
    const offset = table.readUInt16BE(record + 10)

    const start = storageOffset + offset
    const bytes = table.subarray(start, start + length)

    // Windows (3) records are UTF-16BE; Macintosh (1) Roman records are single-byte. Prefer the
    // Windows record when both exist, which is why (3, 1) is written last and wins.
    let value
    if (platformId === 3 || (platformId === 0 && encodingId >= 3)) {
      if (bytes.length % 2 !== 0) continue // malformed UTF-16BE record
      value = Buffer.from(bytes).swap16().toString('utf16le')
    } else if (platformId === 1) {
      value = bytes.toString('latin1')
    } else {
      continue
    }
    if (platformId === 3 || !names.has(nameId)) names.set(nameId, value)
  }
  return names
}

/**
 * Which colour-glyph technology a font uses, if any.
 *
 * Chrome 69 (the Car Thing's browser) supports CBDT/CBLC bitmap emoji and COLRv0, but NOT COLRv1
 * — that landed in Chrome 98. Google Fonts' Noto Color Emoji is COLRv1, so it would render as flat
 * outlines on-device; the legacy CBDT build is the one that works. sync.mjs asserts on this.
 *
 * @param {Buffer} buf
 * @returns {{ kind: 'cbdt' | 'colr' | 'sbix' | 'none', colrVersion: number | null }}
 */
export function readColorFormat(buf) {
  const tables = readTables(buf)
  if (tables.has('CBDT')) return { kind: 'cbdt', colrVersion: null }
  if (tables.has('sbix')) return { kind: 'sbix', colrVersion: null }
  const colr = tables.get('COLR')
  if (colr) return { kind: 'colr', colrVersion: colr.readUInt16BE(0) }
  return { kind: 'none', colrVersion: null }
}
