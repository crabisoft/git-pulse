/**
 * The letters an avatar stands for, and the colour it stands in.
 *
 * Both are derived from the name rather than stored: an account has no picture
 * to upload and nothing to pick a colour from, and a derived pair is stable —
 * the same person is the same two letters in the same colour on every screen of
 * the install, without a byte written anywhere.
 */

/** How many letters an avatar shows. Three stops reading as a monogram. */
const MAX_LETTERS = 2;

/**
 * Initials of a name, at most two.
 *
 * Words are what separate letters, and a name is written by a person: spaces,
 * hyphens and apostrophes all divide one ("Jean-Luc", "N'Diaye"), while a dot
 * abbreviates rather than divides and is dropped with the rest of the
 * punctuation. A single word gives its first letter alone — padding it with the
 * second letter would read as two words that are not there.
 *
 * Empty for a name with no letter in it at all: the avatar then shows nothing,
 * which is honest, where a placeholder glyph would look like a name we failed
 * to read.
 */
export function initials(name: string): string {
  const words = name
    .split(/[\s\-'’.]+/u)
    // A word is one that starts with a letter. This drops what an emoji or a
    // decoration would otherwise contribute, and with it the case where two
    // accounts differing only by a bracket get the same monogram.
    .filter((word) => /^\p{L}/u.test(word));
  return words
    .slice(0, MAX_LETTERS)
    .map((word) => [...word][0].toLocaleUpperCase())
    .join('');
}

/**
 * A hue for a name, in degrees.
 *
 * Deterministic and spread across the wheel, so two accounts side by side are
 * unlikely to share one — and the same account keeps its colour between
 * sessions and between browsers. Only the hue is derived: saturation and
 * lightness stay with the stylesheet, which is what keeps every avatar legible
 * in both themes rather than at the mercy of a hash.
 */
export function nameHue(name: string): number {
  let hash = 0;
  for (const char of name) {
    // Ordinary string hash: multiply, add, keep it in 32 bits.
    hash = (hash * 31 + char.codePointAt(0)!) | 0;
  }
  return Math.abs(hash) % 360;
}
