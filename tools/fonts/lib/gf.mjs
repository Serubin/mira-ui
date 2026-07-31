// Clients for the two upstream sources the manifest is derived from:
//   - Google Fonts: family metadata + per-family CSS (which faces exist, and their unicode-ranges)
//   - Unicode CLDR: which scripts are still in living use
//
// Only generate.mjs talks to the network. sync.mjs runs on every build and works from the
// committed manifest alone (it imports fetchBinary solely to download the on-demand `full` tier).

// The CSS API content-negotiates on User-Agent. With Node's default UA it serves a single bare
// .ttf with NO unicode-range at all, which would silently defeat the lazy per-script loading this
// whole pipeline depends on. Claiming a modern Chrome gets woff2 + per-subset unicode-range.
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36'

const GF_METADATA_URL = 'https://fonts.google.com/metadata/fonts'
const CLDR_SCRIPT_METADATA_URL =
  'https://raw.githubusercontent.com/unicode-org/cldr/main/common/properties/scriptMetadata.txt'
const OFL_TEXT_URL = 'https://openfontlicense.org/documents/OFL.txt'

async function fetchText(url, { binary = false } = {}) {
  const response = await fetch(url, { headers: { 'User-Agent': CHROME_UA } })
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`)
  return binary ? Buffer.from(await response.arrayBuffer()) : await response.text()
}

export async function fetchBinary(url) {
  return fetchText(url, { binary: true })
}

/** Raw text of the Google Fonts metadata endpoint (XSSI-prefixed JSON). */
export async function fetchGoogleFontsMetadata() {
  return fetchText(GF_METADATA_URL)
}

/** Raw text of CLDR's scriptMetadata.txt. */
export async function fetchCldrScriptMetadata() {
  return fetchText(CLDR_SCRIPT_METADATA_URL)
}

/**
 * The canonical SIL Open Font License 1.1 text.
 *
 * Inter and every Noto font is OFL 1.1, which requires the license text and the copyright notices
 * to accompany the font files wherever they are redistributed -- and Mira redistributes them inside
 * the firmware image.
 */
export async function fetchOflText() {
  return fetchText(OFL_TEXT_URL)
}

/**
 * Google prefixes the metadata response with an anti-JSON-hijacking guard (`)]}'`).
 * @param {string} raw
 */
export function parseGoogleFontsMetadata(raw) {
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('Google Fonts metadata contained no JSON object')
  return JSON.parse(raw.slice(start))
}

/**
 * Map ISO 15924 script code -> UAX #31 identifier usage.
 *
 * Column 5 (0-indexed) of scriptMetadata.txt is ID Usage, one of RECOMMENDED, LIMITED_USE,
 * EXCLUSION or UNKNOWN. EXCLUSION means a historic script no longer in living use.
 *
 * @param {string} raw
 * @returns {Map<string, string>}
 */
export function parseCldrScriptUsage(raw) {
  const usage = new Map()
  for (const line of raw.split('\n')) {
    const body = line.split('#')[0].trim()
    if (!body) continue
    const fields = body.split(';').map((field) => field.trim())
    if (fields.length < 6) continue
    usage.set(fields[0], fields[5])
  }
  if (usage.size === 0) throw new Error('parsed no script usage rows from CLDR metadata')
  return usage
}

/**
 * Fetch a family's stylesheet from the CSS API v2.
 * @param {string} family e.g. 'Noto Sans Hebrew'
 * @param {string} [axis] variable-weight query, e.g. 'wght@400..700'
 */
export async function fetchFamilyCss(family, axis = 'wght@400..700') {
  const name = family.replace(/ /g, '+')
  // Static families reject an axis query, so fall back to the plain form.
  for (const query of [`${name}:${axis}`, name]) {
    try {
      return await fetchText(`https://fonts.googleapis.com/css2?family=${query}&display=swap`)
    } catch {
      continue
    }
  }
  throw new Error(`could not fetch CSS for family ${JSON.stringify(family)}`)
}

/**
 * Parse a Google Fonts stylesheet into one record per @font-face.
 *
 * Each block is preceded by a `/* subset *\/` comment naming the subset, which is how we tell a
 * family's own script slice apart from the Latin/Cyrillic/Greek slices it also carries.
 *
 * @param {string} css
 * @returns {{subset: string | null, family: string, weight: string, style: string,
 *            stretch: string | null, url: string, unicodeRange: string | null}[]}
 */
export function parseFamilyCss(css) {
  const faces = []
  // Walk every @font-face and attach the nearest preceding /* subset */ comment. Most families are
  // emitted as comment-then-block, but a few single-subset families come back with no comment at
  // all, and pairing by index would then mis-label every face.
  const blockPattern = /@font-face\s*\{([^}]*)\}/g

  for (const match of css.matchAll(blockPattern)) {
    const body = match[1]
    const preceding = css.slice(0, match.index)
    const commentMatch = /\/\*\s*([^*]+?)\s*\*\/\s*$/.exec(preceding)
    const subset = commentMatch ? commentMatch[1] : null

    const field = (name) => {
      const fieldMatch = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(body)
      return fieldMatch ? fieldMatch[1].trim() : null
    }
    const url = /url\(\s*(?:['"])?(https:\/\/[^)'"]+)(?:['"])?\s*\)/.exec(body)?.[1]
    const family = field('font-family')?.replace(/^['"]|['"]$/g, '')
    const unicodeRange = field('unicode-range')

    if (!url || !family) continue

    // unicode-range may legitimately be absent -- Google serves a few unsubsetted families (e.g.
    // Noto Sans Math) as a single face with no range, which would make the browser download it
    // eagerly for any text at all. Callers are expected to derive a range from the font's cmap.
    faces.push({
      subset,
      family,
      weight: field('font-weight') ?? '400',
      style: field('font-style') ?? 'normal',
      stretch: field('font-stretch'),
      url,
      unicodeRange,
    })
  }
  return faces
}
