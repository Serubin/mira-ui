// Hand-maintained policy for the font manifest. generate.mjs applies this to the upstream Google
// Fonts + CLDR data; nothing here is auto-derived, so every entry needs a stated reason.

// ---------------------------------------------------------------------------------------------
// Subset filtering
// ---------------------------------------------------------------------------------------------
// Almost every Noto family ships Latin/Greek/Cyrillic slices in addition to its own script. Taking
// all of them would duplicate Latin ~160 times and, worse, make font-family stack order decide
// which file serves plain ASCII. So we take each family's own script slice and let a single
// designated family fill the gaps Inter leaves in the shared scripts.

/** The one family allowed to provide supplementary Latin/Greek/Cyrillic coverage. */
export const SUPPLEMENTARY_FAMILY = 'Noto Sans'

// Measured against the four shipped Inter files (see `npm run fonts:audit`):
//   latin       73.4% -- the shortfall is C0/C1 controls, soft hyphen and bidi marks, which are
//                        formatting characters rather than rendered glyphs
//   cyrillic   100.0%
//   vietnamese  99.1% -- only U+0329 COMBINING VERTICAL LINE BELOW
// `menu` is Google's tiny name-display slice and is never useful to us.
export const SUBSETS_COVERED_BY_INTER = new Set(['latin', 'cyrillic', 'vietnamese', 'menu'])

// Inter only partially covers these, so dropping them outright would lose real glyphs. They are
// kept from SUPPLEMENTARY_FAMILY only, and dropped from every other family:
//   latin-ext    62.5% -- missing IPA/phonetic extensions (U+1D01-1D0C, U+0255, U+0285, ...)
//   greek        77.8% -- missing archaic letters (koppa U+03D8-03DB, U+03DE-03EF, ...)
//   greek-ext    91.0% -- missing some polytonic forms (U+1F16-1F17, U+1F46-1F47, ...)
//   cyrillic-ext 44.6% -- missing U+0500-052E, U+1C80-1C8A, U+2DE0-2DFE, U+A640-A69E, ...
export const SUBSETS_FROM_SUPPLEMENTARY_ONLY = new Set([
  'latin-ext',
  'greek',
  'greek-ext',
  'cyrillic-ext',
])

// ---------------------------------------------------------------------------------------------
// Tiering
// ---------------------------------------------------------------------------------------------
// Default tier is derived from CLDR's UAX #31 ID Usage: RECOMMENDED and LIMITED_USE are scripts in
// living use, EXCLUSION is historic. Historic scripts are not shipped -- a Spotify track title is
// not going to be in Cuneiform, and every bundled file costs space on a 516 MiB partition that is
// already slimmed to fit.

export const INCLUDED_ID_USAGE = new Set(['RECOMMENDED', 'LIMITED_USE'])

/** Families shipped regardless of what CLDR says about their script. */
export const ALWAYS_INCLUDE = new Set([
  'Noto Sans', // supplementary Latin/Greek/Cyrillic, plus Devanagari
  'Noto Sans Symbols', // arrows, geometric shapes, misc. symbols that appear in track titles
  'Noto Sans Symbols 2', // includes Braille (U+2800-28FF)
  'Noto Sans Math', // mathematical alphanumerics
  // CLDR marks Mongolian (Mong) EXCLUSION, but it is in everyday use in Inner Mongolia and is a
  // script a track title can plausibly be in.
  'Noto Sans Mongolian',
])

// ---------------------------------------------------------------------------------------------
// Collision resolution
// ---------------------------------------------------------------------------------------------
// When several families claim the same subset, the first one in the CSS font-family stack silently
// wins. Rather than let source order decide, every colliding subset must name a winner here.
// generate.mjs fails if it finds a collision that is not listed.

export const SUBSET_FAMILY_PREFERENCE = {
  // Naskh is the conventional body-text Arabic style and is what Mira already shipped. Kufi is a
  // display face, and Nastaliq is Urdu-specific -- we cannot detect language from Spotify
  // metadata, so a single general-purpose Arabic face is the right call.
  arabic: 'Noto Naskh Arabic',
  // Joined Adlam is the standard orthography; the Unjoined variant is a specialist form.
  adlam: 'Noto Sans Adlam',
  // Prefer the dedicated Devanagari family over the base family's smaller Devanagari slice.
  devanagari: 'Noto Sans Devanagari',
  // Dedicated Hebrew over Rashi, which is a commentary typeface.
  hebrew: 'Noto Sans Hebrew',
  // Syriac has Eastern/Western/Estrangela variants; the base family is the neutral choice.
  syriac: 'Noto Sans Syriac',
  // Looped Thai/Lao are stylistic variants used for specific typographic registers; the plain
  // families are the general-purpose text faces.
  thai: 'Noto Sans Thai',
  lao: 'Noto Sans Lao',
  // Joined N'Ko is the standard orthography, same rationale as Adlam above.
  nko: 'Noto Sans NKo',
  // A dozen families each carry a copy of Google's shared `math` and `symbols` slices. Pin them to
  // the dedicated symbol families so a script family's presence never decides how an arrow or a
  // mathematical operator renders.
  math: 'Noto Sans Symbols 2',
  symbols: 'Noto Sans Symbols',
}

// ---------------------------------------------------------------------------------------------
// Pinned faces
// ---------------------------------------------------------------------------------------------
// Faces that are NOT regenerated from Google Fonts. Their files are committed and their
// unicode-ranges are reproduced verbatim so a regenerate cannot silently change what ships.

/** Inter -- the Latin UI face. Static instances, one file per weight. */
export const PINNED_INTER = [
  { file: 'Inter-Regular.woff2', weight: '400' },
  { file: 'Inter-Medium.woff2', weight: '500' },
  { file: 'Inter-SemiBold.woff2', weight: '600' },
  { file: 'Inter-Bold.woff2', weight: '700' },
].map((face) => ({ ...face, family: 'Inter', style: 'normal', format: 'woff2' }))

// The CJK *files* are left exactly as they were -- these four are ~21 MB of the payload and
// replacing them is a separate decision with its own trade-offs (notably that JP comes first in the
// stack and claims U+4E00-9FAF, so Han renders with Japanese glyph forms).
//
// The ranges below state the *intended scope* of each file and are copied from the pre-generator
// _global.scss. generate.mjs intersects them with each font's real cmap, exactly as it does for the
// generated faces. That matters: as written, these ranges over-claimed by 8,195 codepoints for JP
// (38.3%) and 12,074 for TC (42.6%), and for each of those the browser fetched the whole 4-5 MB
// font, found no glyph, and fell through to the next family.
//
// Note these must stay scoped to the CJK blocks rather than being replaced by each font's full cmap:
// the files also contain Latin and punctuation, and claiming those would pull megabytes of CJK for
// ordinary ASCII text.
export const PINNED_CJK = [
  {
    family: 'Noto Sans JP',
    file: 'NotoSansJP-VF.woff2',
    unicodeRange: 'U+3000-303F, U+3040-309F, U+30A0-30FF, U+FF00-FFEF, U+4E00-9FAF',
  },
  {
    family: 'Noto Sans KR',
    file: 'NotoSansKR-VF.woff2',
    unicodeRange: 'U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7AF',
  },
  {
    family: 'Noto Sans SC',
    file: 'NotoSansSC-VF.woff2',
    unicodeRange: 'U+4E00-9FFF, U+3400-4DBF, U+F900-FAFF',
  },
  {
    family: 'Noto Sans TC',
    file: 'NotoSansTC-VF.woff2',
    unicodeRange: 'U+4E00-9FFF, U+3400-4DBF, U+F900-FAFF, U+2F00-2FDF',
  },
].map((face) => ({ ...face, weight: '400 700', style: 'normal', format: 'woff2' }))

// ---------------------------------------------------------------------------------------------
// Emoji
// ---------------------------------------------------------------------------------------------
// The Car Thing runs Chrome 69, which supports CBDT/CBLC bitmap emoji and COLRv0 but NOT COLRv1
// (Chrome 98+). Google Fonts' Noto Color Emoji is COLRv1 and would render as flat outlines, so we
// take the legacy CBDT build straight from the noto-emoji repo. sync.mjs asserts the file really
// is CBDT so a silent upstream reformat cannot ship broken emoji.
//
// This single file is ~10.7 MB -- roughly 3x the entire living script set -- and because CBDT is
// bitmap data the whole thing decodes into memory as soon as one emoji renders. Downgrade paths if
// image headroom gets tight: NotoColorEmoji-noflags.ttf (~9.8 MB) or the monochrome Noto Emoji
// family (~570 KB).
export const EMOJI = {
  family: 'Noto Color Emoji',
  file: 'NotoColorEmoji.ttf',
  format: 'truetype',
  weight: '400',
  style: 'normal',
  url: 'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/fonts/NotoColorEmoji.ttf',
  requireColorFormat: 'cbdt',
  // Derived from the font's own cmap, but floored at U+00A0 so an emoji face can never shadow
  // ASCII or the C1 range no matter what upstream maps.
  minCodepoint: 0xa0,
}

// ---------------------------------------------------------------------------------------------
// Stack order
// ---------------------------------------------------------------------------------------------
// Order only decides overlaps. Inter leads so Latin always resolves to the UI face; the
// supplementary family follows to fill its gaps; CJK keeps its historical position ahead of the
// generated families; everything else is emitted alphabetically for a stable diff. Emoji goes last
// so a script face wins for any codepoint both claim.
export const STACK_HEAD = ['Inter', SUPPLEMENTARY_FAMILY]
export const STACK_CJK = PINNED_CJK.map((face) => face.family)
export const STACK_TAIL = [EMOJI.family]
