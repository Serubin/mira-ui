#!/usr/bin/env node
// Regenerates tools/fonts/manifest.json from Google Fonts + Unicode CLDR.
//
//   node tools/fonts/generate.mjs          # refresh the manifest and download any new files
//   node tools/fonts/generate.mjs --dry    # report what would change, write nothing
//
// This is a maintenance script, NOT part of the build -- it hits the network and is the only thing
// that may rewrite the manifest. Every build runs sync.mjs instead, which is entirely offline: the
// device never fetches a font over the network, and neither does a build. Re-run this when bumping
// Noto versions, then commit the manifest, the refreshed vendor/ snapshot and any new font files.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  fetchBinary,
  fetchCldrScriptMetadata,
  fetchFamilyCss,
  fetchGoogleFontsMetadata,
  fetchOflText,
  parseCldrScriptUsage,
  parseFamilyCss,
  parseGoogleFontsMetadata,
} from './lib/gf.mjs'
import { readCodepoints, readColorFormat, readNames } from './lib/sfnt.mjs'
import { renderNotice } from './lib/notice.mjs'
import {
  countRanges,
  formatUnicodeRange,
  intersect,
  parseUnicodeRange,
  toRanges,
} from './lib/ranges.mjs'
import {
  ALWAYS_INCLUDE,
  EMOJI,
  INCLUDED_ID_USAGE,
  PINNED_CJK,
  PINNED_INTER,
  SUBSETS_COVERED_BY_INTER,
  SUBSETS_FROM_SUPPLEMENTARY_ONLY,
  SUBSET_FAMILY_PREFERENCE,
  SUPPLEMENTARY_FAMILY,
} from './config.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const FONTS_DIR = path.join(HERE, '../../public/fonts')
const VENDOR_DIR = path.join(HERE, 'vendor')
const MANIFEST = path.join(HERE, 'manifest.json')

const dryRun = process.argv.includes('--dry')
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// CJK is pinned (see config.mjs PINNED_CJK), so the CJK sans families must not be collected from
// upstream as well -- Google serves each as ~100 numbered slices, which would both duplicate the
// committed files and reopen the Han-glyph-source question this change deliberately leaves alone.
const PINNED_CJK_FAMILIES = new Set([
  'Noto Sans JP',
  'Noto Sans KR',
  'Noto Sans SC',
  'Noto Sans TC',
  'Noto Sans HK',
])

/** Families that would collide with the sans faces on every subset without adding coverage. */
function isCandidateFamily(family) {
  if (!family.isNoto) return false
  const name = family.family
  if (/Serif|Mono|Display|Emoji|Music/.test(name)) return false
  if (PINNED_CJK_FAMILIES.has(name)) return false
  return true
}

/** Short, stable filename for a face, e.g. 'NotoSansHebrew-hebrew.woff2'. */
function fileNameFor(family, subset, extension) {
  const base = family.replace(/[^A-Za-z0-9]/g, '')
  return `${base}-${subset}.${extension}`
}

/** Whether a family's script is in living use, and so worth the bytes. */
function isIncluded(familyName, primaryScript, scriptUsage) {
  if (ALWAYS_INCLUDE.has(familyName)) return true
  const usage = scriptUsage.get(primaryScript)
  return usage !== undefined && INCLUDED_ID_USAGE.has(usage)
}

/**
 * Decide whether a face's subset should be kept for this family.
 * @returns {boolean}
 */
function keepSubset(subset, familyName) {
  if (subset === null) return true // family's own script, unlabelled
  if (SUBSETS_COVERED_BY_INTER.has(subset)) return false
  if (SUBSETS_FROM_SUPPLEMENTARY_ONLY.has(subset)) return familyName === SUPPLEMENTARY_FAMILY
  return true
}

async function main() {
  console.error('fetching upstream metadata...')
  const [gfRaw, cldrRaw] = await Promise.all([
    fetchGoogleFontsMetadata(),
    fetchCldrScriptMetadata(),
  ])
  const scriptUsage = parseCldrScriptUsage(cldrRaw)
  const metadata = parseGoogleFontsMetadata(gfRaw)
  const notoFamilies = metadata.familyMetadataList.filter(isCandidateFamily)
  const candidates = notoFamilies.filter((family) =>
    isIncluded(family.family, family.primaryScript, scriptUsage),
  )
  const skipped = notoFamilies.length - candidates.length
  console.error(
    `  ${notoFamilies.length} Noto families, ${scriptUsage.size} CLDR script classifications`,
  )
  console.error(
    `  ${candidates.length} in living use; skipping ${skipped} historic (CLDR ID_USAGE=EXCLUSION)`,
  )

  // A preference naming a family we no longer ship is dead config that reads as if it were still in
  // force. Catch it here rather than letting it rot silently.
  const candidateNames = new Set(candidates.map((family) => family.family))
  const stale = Object.entries(SUBSET_FAMILY_PREFERENCE).filter(
    ([, preferred]) => !candidateNames.has(preferred),
  )
  if (stale.length > 0) {
    throw new Error(
      `SUBSET_FAMILY_PREFERENCE names ${stale.length} family/families that are not shipped:\n` +
        stale.map(([subset, preferred]) => `  ${subset}: ${preferred}`).join('\n') +
        `\nRemove the entry, or add the family to ALWAYS_INCLUDE.`,
    )
  }

  // ---- collect every face we might want -------------------------------------------------------
  const collected = []
  let done = 0
  await Promise.all(
    candidates.map(async (family) => {
      const css = await fetchFamilyCss(family.family)
      // The API echoes the canonical family name; trust the request, not the response, so a
      // renamed family cannot quietly attach its faces to another family's stack entry.
      const parsed = parseFamilyCss(css).filter((face) => face.family === family.family)

      // Some families are additionally served as numbered slices (src ending `.90.woff2`) carrying
      // no subset comment. For every non-CJK family these duplicate coverage the labelled subsets
      // already provide -- Mongolian, the only such family here, has 23 numbered slices holding
      // 4118 codepoints of symbols and Latin, and zero Mongolian codepoints that its labelled
      // `mongolian` face lacks. Taking them would reintroduce cross-family overlap that stack order
      // silently resolves, so prefer labelled subsets whenever they exist.
      const labelled = parsed.filter((face) => face.subset !== null)

      // A single-subset family may come back with no comment at all; that lone face is its script
      // slice. More than one unlabelled face with nothing labelled would be ambiguous, so refuse.
      let selectedFaces = labelled
      if (labelled.length === 0) {
        if (parsed.length !== 1) {
          throw new Error(
            `${family.family} returned ${parsed.length} unlabelled faces and no labelled subsets; ` +
              `cannot tell which subset each covers`,
          )
        }
        selectedFaces = parsed
      }

      for (const face of selectedFaces) {
        const subset = face.subset ?? (family.primaryScript || 'default').toLowerCase()
        if (!keepSubset(face.subset, family.family)) continue
        collected.push({
          ...face,
          subset,
          familyName: family.family,
          primaryScript: family.primaryScript || '',
        })
      }
      if (++done % 25 === 0) console.error(`  ...${done}/${candidates.length} families`)
    }),
  )
  console.error(`  ${collected.length} candidate faces after subset filtering`)

  // ---- resolve subset collisions -------------------------------------------------------------
  const bySubset = new Map()
  for (const face of collected) {
    if (!bySubset.has(face.subset)) bySubset.set(face.subset, [])
    bySubset.get(face.subset).push(face)
  }

  const selected = []
  const undeclared = []
  for (const [subset, faces] of bySubset) {
    const families = [...new Set(faces.map((face) => face.familyName))]
    if (families.length === 1) {
      selected.push(...faces)
      continue
    }
    const preferred = SUBSET_FAMILY_PREFERENCE[subset]
    if (!preferred) {
      undeclared.push({ subset, families })
      continue
    }
    if (!families.includes(preferred)) {
      throw new Error(
        `SUBSET_FAMILY_PREFERENCE[${subset}] is ${JSON.stringify(preferred)}, ` +
          `but only ${families.join(', ')} provide that subset`,
      )
    }
    selected.push(...faces.filter((face) => face.familyName === preferred))
  }

  if (undeclared.length > 0) {
    // Failing loudly is the point: an unresolved collision means stack order silently decides which
    // font renders a script, which is exactly the class of bug this pipeline exists to prevent.
    const detail = undeclared
      .map(({ subset, families }) => `  ${subset}: ${families.join(', ')}`)
      .join('\n')
    throw new Error(
      `${undeclared.length} subset(s) are claimed by multiple families with no entry in ` +
        `SUBSET_FAMILY_PREFERENCE. Add a winner (with a reason) for each:\n${detail}`,
    )
  }

  // ---- download, verify and narrow ranges ----------------------------------------------------
  if (!dryRun) {
    await mkdir(FONTS_DIR, { recursive: true })
    await mkdir(VENDOR_DIR, { recursive: true })
  }

  const entries = []
  for (const face of selected) {
    const file = fileNameFor(face.familyName, face.subset, 'woff2')
    const buf = await fetchBinary(face.url)

    const codepoints = readCodepoints(buf)
    let actual
    if (face.unicodeRange === null) {
      // Unsubsetted family: the font's own cmap is the only source of truth for its range. Without
      // this the face would have no unicode-range and be fetched eagerly for any text.
      actual = toRanges(codepoints)
      console.error(
        `  derived range for ${face.familyName} (${face.subset}) from cmap: ` +
          `${codepoints.size} codepoints (upstream sent no unicode-range)`,
      )
    } else {
      const declared = parseUnicodeRange(face.unicodeRange)
      actual = intersect(declared, codepoints)
      if (actual.length === 0) {
        throw new Error(
          `${face.familyName} (${face.subset}) declares ${face.unicodeRange} but the file covers ` +
            `none of it -- upstream subset mismatch, refusing to ship`,
        )
      }
      const dropped = countRanges(declared) - countRanges(actual)
      if (dropped > 0) {
        console.error(
          `  narrowed ${face.familyName} (${face.subset}): dropped ${dropped} unmapped codepoints`,
        )
      }
    }

    entries.push({
      family: face.familyName,
      subset: face.subset,
      script: face.primaryScript,
      file,
      format: 'woff2',
      weight: face.weight,
      style: face.style,
      stretch: face.stretch,
      unicodeRange: formatUnicodeRange(actual),
      copyright: readNames(buf).get(0) ?? null,
      bytes: buf.length,
      sha256: sha256(buf),
      url: face.url,
    })

    if (!dryRun) {
      await writeFile(path.join(FONTS_DIR, file), buf)
    }
  }

  // ---- emoji ----------------------------------------------------------------------------------
  const emojiBuf = await fetchBinary(EMOJI.url)
  const colorFormat = readColorFormat(emojiBuf)
  if (colorFormat.kind !== EMOJI.requireColorFormat) {
    throw new Error(
      `${EMOJI.file} is ${colorFormat.kind}` +
        (colorFormat.colrVersion !== null ? `v${colorFormat.colrVersion}` : '') +
        `, expected ${EMOJI.requireColorFormat}. Chrome 69 cannot render COLRv1, so shipping this ` +
        `would show flat outlines on-device.`,
    )
  }
  const emojiCodepoints = [...readCodepoints(emojiBuf)].filter((cp) => cp >= EMOJI.minCodepoint)
  entries.push({
    family: EMOJI.family,
    subset: 'emoji',
    script: 'Zsye',
    file: EMOJI.file,
    format: EMOJI.format,
    weight: EMOJI.weight,
    style: EMOJI.style,
    stretch: null,
    unicodeRange: formatUnicodeRange(
      intersect([[EMOJI.minCodepoint, 0x10ffff]], new Set(emojiCodepoints)),
    ),
    copyright: readNames(emojiBuf).get(0) ?? null,
    bytes: emojiBuf.length,
    sha256: sha256(emojiBuf),
    url: EMOJI.url,
  })
  if (!dryRun) await writeFile(path.join(FONTS_DIR, EMOJI.file), emojiBuf)

  // ---- pinned faces (files already committed; hash what is on disk) --------------------------
  for (const face of [...PINNED_INTER, ...PINNED_CJK]) {
    const buf = await readFile(path.join(FONTS_DIR, face.file))
    if (face.unicodeRange) {
      const declared = parseUnicodeRange(face.unicodeRange)
      const dropped = countRanges(declared) - countRanges(intersect(declared, readCodepoints(buf)))
      if (dropped > 0)
        console.error(`  narrowed ${face.family}: dropped ${dropped} unmapped codepoints`)
    }
    entries.push({
      family: face.family,
      subset: face.family === 'Inter' ? `latin-${face.weight}` : 'cjk',
      script: '',
      pinned: true,
      file: face.file,
      format: face.format,
      weight: face.weight,
      style: face.style,
      stretch: null,
      // Intersect the intended scope with what the file actually maps. The hand-written CJK ranges
      // over-claimed by thousands of codepoints, and for each one the browser fetched a 4-5 MB font
      // only to find no glyph. Inter carries no range at all -- it is the base Latin face.
      unicodeRange: face.unicodeRange
        ? formatUnicodeRange(intersect(parseUnicodeRange(face.unicodeRange), readCodepoints(buf)))
        : null,
      copyright: readNames(buf).get(0) ?? null,
      bytes: buf.length,
      sha256: sha256(buf),
      url: null,
    })
  }

  entries.sort(
    (a, b) => a.family.localeCompare(b.family) || String(a.subset).localeCompare(String(b.subset)),
  )

  const manifest = {
    // Regenerate with `node tools/fonts/generate.mjs`; do not hand-edit.
    generator: 'tools/fonts/generate.mjs',
    inclusionRule:
      'Scripts in living use only: CLDR UAX#31 ID_USAGE in {RECOMMENDED, LIMITED_USE}, plus ' +
      'config.mjs ALWAYS_INCLUDE. Historic scripts (ID_USAGE=EXCLUSION) are not shipped.',
    faces: entries,
  }

  const report = (label, rows) => {
    const bytes = rows.reduce((total, entry) => total + entry.bytes, 0)
    console.error(
      `  ${label.padEnd(30)} ${String(rows.length).padStart(3)} faces  ` +
        `${(bytes / 1e6).toFixed(2).padStart(6)} MB`,
    )
  }
  const isEmoji = (entry) => entry.family === EMOJI.family
  console.error('\npayload:')
  report(
    'pinned Inter + CJK',
    entries.filter((entry) => entry.pinned),
  )
  report(
    'scripts',
    entries.filter((entry) => !entry.pinned && !isEmoji(entry)),
  )
  report('colour emoji', entries.filter(isEmoji))
  report('TOTAL', entries)

  if (dryRun) {
    console.error('\n--dry: manifest not written')
    return
  }
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  // Keep the CLDR snapshot as the audit trail for the inclusion decision -- a reviewer can check any
  // script's ID_USAGE against it without a network round trip. The Google Fonts metadata dump is
  // deliberately not vendored: it is 2.5 MB and everything we derive from it (family, script,
  // source URL) is already recorded per face in the manifest.
  await writeFile(path.join(VENDOR_DIR, 'cldr-scriptMetadata.txt'), cldrRaw)

  // OFL 1.1 requires the license text and copyright notices to travel with the fonts. These land
  // in public/fonts/, so they are copied into dist/ and end up inside the firmware image next to
  await writeFile(path.join(FONTS_DIR, 'OFL.txt'), await fetchOflText())
  await writeFile(path.join(FONTS_DIR, 'NOTICE'), renderNotice(entries))

  console.error(`\nwrote ${path.relative(process.cwd(), MANIFEST)}`)
}

await main()
