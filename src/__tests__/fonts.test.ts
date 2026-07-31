import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- untyped build tooling, exercised here so the generator logic is covered
import { readCodepoints, readColorFormat } from '../../tools/fonts/lib/sfnt.mjs'
// @ts-expect-error -- untyped build tooling
import { parseUnicodeRange } from '../../tools/fonts/lib/ranges.mjs'
// @ts-expect-error -- untyped build tooling
import { buildStack, SYSTEM_FALLBACKS } from '../../tools/fonts/lib/emit.mjs'

// Guards the font pipeline that makes non-Latin text render at all. The bug these tests exist for:
// 'Noto Sans Hebrew' sat in the $font-system stack with no @font-face rule anywhere, so the Hebrew
// font shipped in the image and was never requested, and every Hebrew title rendered as tofu.

interface Face {
  family: string
  subset: string
  script: string
  pinned?: boolean
  file: string
  format: string
  weight: string
  style: string
  unicodeRange: string | null
  copyright: string | null
  bytes: number
  sha256: string
  url: string | null
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const FONTS_DIR = path.join(ROOT, 'public/fonts')
const STYLES_DIR = path.join(ROOT, 'src/styles')

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'tools/fonts/manifest.json'), 'utf8')) as {
  faces: Face[]
}

const faces = manifest.faces

// The generated SCSS is written by `npm run fonts`, which runs as pretest/prebuild/predev.
const facesScss = readFileSync(path.join(STYLES_DIR, '_font-faces.generated.scss'), 'utf8')
const stackScss = readFileSync(path.join(STYLES_DIR, '_font-stack.generated.scss'), 'utf8')

/** Family names in declaration order from the generated $font-system list. */
function stackFamilies(scss: string): string[] {
  const body = /\$font-system:\s*([^;]+);/.exec(scss)?.[1]
  if (!body) throw new Error('could not find $font-system in the generated stack')
  return body
    .split(',')
    .map((entry) => entry.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
}

/** font-family values from every @font-face rule in the generated stylesheet. */
function faceFamilies(scss: string): string[] {
  return [...scss.matchAll(/@font-face\s*\{[^}]*?font-family:\s*'([^']+)'/g)].map((m) => m[1])
}

const readFont = (face: Face) => readFileSync(path.join(FONTS_DIR, face.file))

describe('font manifest', () => {
  it('ships every face as a committed file', () => {
    const present = new Set(readdirSync(FONTS_DIR))
    const missing = faces.filter((face) => !present.has(face.file)).map((face) => face.file)
    expect(missing).toEqual([])
  })

  it('has no committed font file that the manifest does not reference', () => {
    // An orphan still gets zipped into the firmware image while no @font-face rule points at it.
    const expected = new Set(faces.map((face) => face.file))
    const orphans = readdirSync(FONTS_DIR)
      .filter((name) => name.endsWith('.woff2') || name.endsWith('.ttf'))
      .filter((name) => !expected.has(name))
    expect(orphans).toEqual([])
  })

  it('declares a unicode-range for every face except the base Latin one', () => {
    // A face with no unicode-range is downloaded eagerly for any text on the page. Only Inter, the
    // face that actually renders Latin UI copy, is allowed to be unconditional.
    const unconditional = faces.filter((face) => !face.unicodeRange).map((face) => face.family)
    expect([...new Set(unconditional)]).toEqual(['Inter'])
  })

  it('records a copyright notice for every face, for OFL attribution', () => {
    const missing = faces.filter((face) => !face.copyright).map((face) => face.file)
    expect(missing).toEqual([])
  })
})

describe('generated stylesheet', () => {
  it('gives every family in the stack at least one @font-face rule', () => {
    // The exact invariant Hebrew violated.
    const declared = new Set(faceFamilies(facesScss))
    const fallbacks = new Set(SYSTEM_FALLBACKS.map((f: string) => f.replace(/^'|'$/g, '')))
    const unbacked = stackFamilies(stackScss).filter(
      (family) => !fallbacks.has(family) && !declared.has(family),
    )
    expect(unbacked).toEqual([])
  })

  it('names every @font-face family in the stack', () => {
    // The reverse: a face no font-family stack can ever select is dead weight in the image.
    const inStack = new Set(stackFamilies(stackScss))
    const unreachable = [...new Set(faceFamilies(facesScss))].filter(
      (family) => !inStack.has(family),
    )
    expect(unreachable).toEqual([])
  })

  it('points every src at a file that exists', () => {
    const urls = [...facesScss.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1])
    expect(urls.length).toBe(faces.length)
    const missing = urls.filter((rel) => !existsSync(path.join(FONTS_DIR, rel)))
    expect(missing).toEqual([])
  })

  it('puts Inter first and emoji last', () => {
    // Inter must win Latin; emoji must lose every codepoint a real script face also claims.
    const families = stackFamilies(stackScss)
    expect(families[0]).toBe('Inter')
    const bundled = families.filter(
      (f) => !new Set(SYSTEM_FALLBACKS.map((s: string) => s.replace(/^'|'$/g, ''))).has(f),
    )
    expect(bundled[bundled.length - 1]).toBe('Noto Color Emoji')
  })

  it('sets font-display on every face so text is never invisible while loading', () => {
    expect(facesScss.match(/font-display:\s*swap/g)).toHaveLength(faces.length)
  })

  it('matches what buildStack derives from the manifest', () => {
    const expected = buildStack(new Set(faces.map((face) => face.family)))
    expect(stackFamilies(stackScss)).toEqual(
      expected.map((entry: string) => entry.replace(/^'|'$/g, '')),
    )
  })
})

describe('font files', () => {
  const overClaimed = (face: Face): number => {
    const codepoints = readCodepoints(readFont(face)) as Set<number>
    const declared = parseUnicodeRange(face.unicodeRange!) as [number, number][]
    let count = 0
    for (const [start, end] of declared) {
      for (let cp = start; cp <= end; cp++) if (!codepoints.has(cp)) count++
    }
    return count
  }

  const ranged = faces.filter((face) => face.unicodeRange)

  it.each(ranged.map((face) => [face.file, face] as const))(
    'declares only codepoints %s actually contains',
    (_file, face) => {
      // Two bugs this catches. A mislabelled font: the previous hand-written CSS shipped
      // NotoSansGK-VF.woff2 as 'Noto Sans Greek' with unicode-range U+0370-03FF, but that file is
      // Gurmukhi and contains zero Greek codepoints. And an over-claiming range: the hand-written
      // CJK ranges over-claimed by 8,195 codepoints for JP and 12,074 for TC, and for each of those
      // the browser fetched a 4-5 MB font, found no glyph, and fell through to the next family.
      //
      // Applies to every face including the pinned CJK ones -- the generator intersects each
      // declared range with the font's real cmap, so this must hold exactly.
      expect(overClaimed(face)).toBe(0)
    },
  )

  it('uses a colour emoji format Chrome 69 can actually render', () => {
    // Google Fonts' Noto Color Emoji is COLRv1, which needs Chrome 98+; on the Car Thing it would
    // render as flat outlines. Only the legacy CBDT bitmap build works.
    const emoji = faces.find((face) => face.family === 'Noto Color Emoji')
    expect(emoji).toBeDefined()
    expect(readColorFormat(readFont(emoji!))).toEqual({ kind: 'cbdt', colrVersion: null })
  })

  it.each([
    ['Hebrew', 0x05d0], // ALEF -- the script from the original bug report
    ['Arabic', 0x0627], // ALEF
    ['Thaana', 0x0780], // HAA, the other RTL script in common use
    ['Devanagari', 0x0915], // KA
    ['Gurmukhi', 0x0a15], // KA -- was unreachable when its font was mislabelled as Greek
    ['Thai', 0x0e01], // KO KAI
    ['Greek', 0x03b1], // ALPHA
    ['Cyrillic', 0x0430], // A
    ['Georgian', 0x10d0], // AN
    ['Ethiopic', 0x1200], // HA
    ['Cherokee', 0x13a0], // A
    ['Khmer', 0x1780], // KA
    ['Japanese kana', 0x3042], // HIRAGANA A
    ['Korean hangul', 0xac00], // GA
    ['Han', 0x4e2d], // ZHONG
  ])('has a face covering %s', (_name, codepoint) => {
    const covering = faces.filter((face) => {
      if (!face.unicodeRange) return false
      const ranges = parseUnicodeRange(face.unicodeRange) as [number, number][]
      return ranges.some(([start, end]) => codepoint >= start && codepoint <= end)
    })
    expect(covering.length).toBeGreaterThan(0)

    // and the font really has the glyph, not just a range claiming it
    const codepoints = readCodepoints(readFont(covering[0])) as Set<number>
    expect(codepoints.has(codepoint)).toBe(true)
  })
})

describe('everything is served locally', () => {
  // The device has no general internet access and must not depend on any. A font referenced by an
  // absolute URL would simply never load on-device, so every src has to be a local path.
  const REMOTE = /https?:\/\//

  it('references no remote URL from any @font-face', () => {
    const remote = [...facesScss.matchAll(/src:\s*url\('([^']+)'\)/g)]
      .map((m) => m[1])
      .filter((url) => REMOTE.test(url) || url.startsWith('//'))
    expect(remote).toEqual([])
  })

  it('uses only root-relative /fonts/ paths', () => {
    const srcs = [...facesScss.matchAll(/src:\s*url\('([^']+)'\)/g)].map((m) => m[1])
    expect(srcs).toHaveLength(faces.length)
    expect(srcs.filter((url) => !url.startsWith('/fonts/'))).toEqual([])
  })

  it('loads no remote font from the boot splash in index.html', () => {
    // index.html carries its own inline @font-face so the splash has type before the bundle runs.
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    const srcs = [...html.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1])
    expect(srcs.filter((url) => !url.startsWith('/fonts/'))).toEqual([])
  })

  it('keeps the upstream download URLs out of anything that ships', () => {
    // The manifest records where each font came from, which is build-time provenance only. It lives
    // in tools/ and must never be copied into public/, or those URLs would reach the device.
    expect(existsSync(path.join(ROOT, 'public/fonts/manifest.json'))).toBe(false)
    const shipped = readdirSync(FONTS_DIR)
      .filter((name) => name.endsWith('.json'))
      .filter((name) => name !== 'OFL.txt')
    expect(shipped).toEqual([])
  })
})

describe('payload budget', () => {
  // The rootfs is capped at 516 MiB (mira-firmware build.sh) and stages/30/35-slim-rootfs.sh
  // already deletes files to fit when voice is bundled. Guard against silent growth.
  const megabytes = (rows: Face[]) => rows.reduce((total, f) => total + f.bytes, 0) / 1e6

  it('stays within the overall budget', () => {
    expect(megabytes(faces)).toBeLessThan(37)
  })

  it('keeps script coverage small -- it is the cheap part', () => {
    const scripts = faces.filter((f) => !f.pinned && f.family !== 'Noto Color Emoji')
    expect(megabytes(scripts)).toBeLessThan(5)
  })
})
