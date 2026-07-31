#!/usr/bin/env node
// Build step: turn tools/fonts/manifest.json into the SCSS the app compiles.
//
// Runs as prebuild/predev/pretest. Entirely offline and network-free -- every font is committed
// under public/fonts/, verified here against the manifest's hashes, and served from the device's own
// filesystem at runtime. Nothing about fonts ever touches the internet outside generate.mjs.

import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { readColorFormat } from './lib/sfnt.mjs'
import { buildStack, orderFaces, renderFace } from './lib/emit.mjs'
import { EMOJI } from './config.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const FONTS_DIR = path.join(HERE, '../../public/fonts')
const STYLES_DIR = path.join(HERE, '../../src/styles')
const MANIFEST = path.join(HERE, 'manifest.json')

const BANNER = (extra) =>
  [
    '// GENERATED FILE -- do not edit.',
    '//',
    '// Written by tools/fonts/sync.mjs from tools/fonts/manifest.json.',
    `// ${extra}`,
    '// To change which fonts ship, edit tools/fonts/config.mjs and re-run',
    '// `node tools/fonts/generate.mjs`.',
    '',
  ].join('\n')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const isFontFile = (name) => name.endsWith('.woff2') || name.endsWith('.ttf')

/** Read a committed face and check it is byte-for-byte what the manifest recorded. */
async function readVerified(face) {
  const target = path.join(FONTS_DIR, face.file)
  let buf
  try {
    buf = await readFile(target)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    throw new Error(
      `public/fonts/${face.file} is missing. Every font is committed -- restore it with ` +
        `\`git checkout -- public/fonts\` rather than regenerating.`,
    )
  }

  const digest = sha256(buf)
  if (digest !== face.sha256) {
    throw new Error(
      `${face.file} does not match the manifest (expected sha256 ${face.sha256}, got ${digest}). ` +
        `Re-run tools/fonts/generate.mjs if this change is intended.`,
    )
  }
  return buf
}

/**
 * Fail on font files that no face in the manifest references.
 *
 * An orphan would still be zipped into the firmware image, wasting space on a partition already
 * slimmed to fit, while never being referenced by any @font-face rule.
 */
async function assertNoOrphans(manifest) {
  const expected = new Set(manifest.faces.map((face) => face.file))
  const present = (await readdir(FONTS_DIR)).filter(isFontFile)
  const orphans = present.filter((name) => !expected.has(name)).sort()
  if (orphans.length > 0) {
    throw new Error(
      `public/fonts has ${orphans.length} file(s) not in the manifest: ${orphans.join(', ')}. ` +
        `Delete them, or re-run tools/fonts/generate.mjs.`,
    )
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
  await assertNoOrphans(manifest)

  const faces = orderFaces(manifest.faces)

  let bytes = 0
  for (const face of faces) {
    const buf = await readVerified(face)
    bytes += buf.length

    // Chrome 69 renders COLRv1 as flat outlines. Re-check on every build so an upstream reformat of
    // the emoji font cannot silently ship broken glyphs.
    if (face.family === EMOJI.family) {
      const format = readColorFormat(buf)
      if (format.kind !== EMOJI.requireColorFormat) {
        throw new Error(
          `${face.file} is ${format.kind}` +
            `${format.colrVersion !== null ? `v${format.colrVersion}` : ''}, ` +
            `expected ${EMOJI.requireColorFormat}; Chrome 69 cannot render it.`,
        )
      }
    }
  }

  const families = new Set(faces.map((face) => face.family))

  await writeFile(
    path.join(STYLES_DIR, '_font-faces.generated.scss'),
    [
      BANNER(`${faces.length} faces, ${(bytes / 1e6).toFixed(2)} MB, all served locally.`),
      faces.map(renderFace).join('\n'),
      '',
    ].join('\n'),
  )

  await writeFile(
    path.join(STYLES_DIR, '_font-stack.generated.scss'),
    [
      BANNER('The font-family stack covering every bundled script.'),
      '$font-system:',
      `${buildStack(families)
        .map((family) => `  ${family}`)
        .join(',\n')};`,
      '',
    ].join('\n'),
  )

  console.error(
    `fonts: ${faces.length} faces, ${families.size} families, ${(bytes / 1e6).toFixed(2)} MB`,
  )
}

await main()
