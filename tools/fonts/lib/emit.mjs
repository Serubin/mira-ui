// Turns manifest entries into the SCSS the app compiles.
//
// Split out of sync.mjs so the tests can exercise the face/stack relationship directly. The
// invariant that matters: every family named in $font-system must have at least one @font-face, and
// vice versa. Violating the first is what made Hebrew render as tofu -- 'Noto Sans Hebrew' sat in
// the stack with no @font-face rule anywhere, so the shipped font was never requested.

import { STACK_CJK, STACK_HEAD, STACK_TAIL } from '../config.mjs'

/** Dev-machine fallbacks appended after every bundled family. */
export const SYSTEM_FALLBACKS = [
  '-apple-system',
  'BlinkMacSystemFont',
  "'Helvetica Neue'",
  'sans-serif',
]

/**
 * Public URL for a face -- always a root-relative path under /fonts.
 *
 * Never an absolute URL: the device has no internet by design, and `static-web-server --root
 * /etc/mira/ui` serves these straight off the local filesystem.
 */
export const urlFor = (face) => `/fonts/${face.file}`

/** Stable emission order: pinned first, then generated families, emoji last. Diff-friendly. */
export function orderFaces(faces) {
  const rank = (face) => {
    if (face.family === 'Inter') return 0
    if (STACK_HEAD.includes(face.family)) return 1
    if (STACK_CJK.includes(face.family)) return 2
    if (STACK_TAIL.includes(face.family)) return 4
    return 3
  }
  return [...faces].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.family.localeCompare(b.family) ||
      String(a.subset).localeCompare(String(b.subset)),
  )
}

export function renderFace(face) {
  const lines = [
    '@font-face {',
    `  font-family: '${face.family}';`,
    `  src: url('${urlFor(face)}') format('${face.format}');`,
    `  font-weight: ${face.weight};`,
    `  font-style: ${face.style};`,
  ]
  if (face.stretch) lines.push(`  font-stretch: ${face.stretch};`)
  // Without font-display the browser blocks on the face for up to 3s, so non-Latin text renders as
  // nothing at all rather than as fallback glyphs.
  lines.push('  font-display: swap;')
  // Inter is the base face and must match every codepoint it can, so it carries no unicode-range.
  // Everything else is gated so the file is only fetched when its script actually appears.
  if (face.unicodeRange) lines.push(`  unicode-range: ${face.unicodeRange};`)
  lines.push('}')
  return lines.join('\n')
}

/**
 * Build the font-family stack.
 *
 * Order only matters where unicode-ranges overlap. Inter leads so Latin always resolves to the UI
 * face; the supplementary Noto Sans follows to fill Inter's gaps in latin-ext/greek/cyrillic-ext;
 * CJK keeps its historical position; emoji goes last so a real script face wins any codepoint both
 * claim (the emoji font also maps (c), (R) and TM).
 *
 * @param {Set<string>} families every family with at least one face in this tier
 * @returns {string[]} CSS font-family entries, already quoted where required
 */
export function buildStack(families) {
  const middle = [...families]
    .filter(
      (family) =>
        !STACK_HEAD.includes(family) && !STACK_CJK.includes(family) && !STACK_TAIL.includes(family),
    )
    .sort((a, b) => a.localeCompare(b))

  // Family names must be quoted. Several contain digits ('Noto Sans Symbols 2'), which is not a
  // valid unquoted CSS <family-name> at all, and quoting the rest keeps the list uniform.
  const present = (list) => list.filter((family) => families.has(family))
  return [
    ...[...present(STACK_HEAD), ...present(STACK_CJK), ...middle, ...present(STACK_TAIL)].map(
      (family) => `'${family}'`,
    ),
    // On the Car Thing none of these exist and sans-serif resolves to Bitstream Vera, the only
    // system font in the image -- which is why every script above needs a bundled webfont.
    ...SYSTEM_FALLBACKS,
  ]
}
