// Bidirectional-text helpers for remote strings.
//
// Track titles, artists, lyrics and Bluetooth device names all come from outside the app and may be
// in any script. Where such a string is rendered on its own, `dir="auto"` on the element is enough.
// Where one is interpolated into an English sentence, it needs isolating instead -- see below.

const FIRST_STRONG_ISOLATE = '⁨'
const POP_DIRECTIONAL_ISOLATE = '⁩'

/**
 * Wrap a remote string so surrounding text cannot be reordered around it.
 *
 * Without this, an RTL device name inside an LTR sentence drags neighbouring punctuation into the
 * RTL run: `Connected to شبكة, but internet sharing is off.` renders with the comma on the wrong
 * side of the name. FSI...PDI opens an isolate whose direction is auto-detected from the wrapped
 * text's first strong character, so the name lays out correctly without affecting the sentence.
 *
 * These are formatting characters with no glyphs, so they are safe to embed in template strings.
 * Prefer `dir="auto"` on the element when the remote string is the entire text content.
 */
export function isolate(text: string): string {
  return `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`
}
