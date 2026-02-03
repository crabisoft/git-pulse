/**
 * What the rewriting asks of a model, and what it makes of the answer. Pure and
 * apart from the service for the same reason the DORA maths are: this is where
 * a silent change of behaviour would pass for a stylistic one.
 */

/** Largest note we hand to a model, in characters. */
export const REWRITE_MAX_CHARS = 60_000;

/**
 * The instructions. Written as constraints rather than as a style, because the
 * failure that matters here is not a dull sentence — it is a release note that
 * says something the commits did not.
 */
export const REWRITE_SYSTEM = [
  'You rewrite generated release notes into notes a reader can use.',
  '',
  'Rules, in order of importance:',
  '1. Never state anything the input does not. No new features, no impact,',
  '   no numbers, no dates. If an entry is cryptic, leave it cryptic.',
  '2. Keep every Markdown link exactly as written — commit links and ticket',
  '   links are how a reader verifies you. Keep every heading level.',
  '3. Keep every entry. Merging two entries that describe one change is',
  '   allowed; dropping one is not.',
  '4. Rewrite the wording: expand terse commit subjects into sentences, drop',
  '   the Conventional Commits prefixes, and put what a reader acts on first.',
  '5. Answer with the Markdown and nothing else — no preamble, no code fence',
  '   around the whole document.',
  '6. The language of the notes comes from the entries you are given, never',
  '   from the language of these instructions.',
].join('\n');

/**
 * The instruction that carries the target language.
 *
 * Omitted, the notes are written in whatever language the commits were written
 * in — and that has to be said, at length, because everything around it pulls
 * the other way: these instructions are in English, the reader's interface may
 * be in French, and a model handed a French interface and English commits will
 * cheerfully translate unless told not to. What a release note reports is what
 * a repository's own history says, in the words it says it.
 *
 * A language named here is a translation somebody asked for, which is a
 * different thing and stays available.
 */
export function languageInstruction(language: string | undefined): string {
  return language
    ? `Write the notes in ${language}, translating the entries as needed. Leave identifiers, link targets and code alone.`
    : [
        'Write the notes in the language the entries below are already written in —',
        'the language of the commit messages themselves. If they are in English, the',
        'notes are in English; if they are in French, the notes are in French. Do not',
        'translate, and do not follow the language of these instructions.',
      ].join(' ');
}

/** The user turn: the instruction, then the notes to work on. */
export function buildRewritePrompt(markdown: string, language?: string): string {
  return `${languageInstruction(language)}\n\nRelease notes to rewrite:\n\n${markdown}`;
}

/**
 * The Markdown out of a model's answer. Models routinely wrap a whole document
 * in a fence despite being asked not to; unwrapping it here is cheaper than
 * shipping a note whose first line is three backticks.
 *
 * Only a fence around the *entire* answer is removed — one around a code sample
 * inside the notes is content.
 */
export function readRewritten(answer: string): string {
  const trimmed = answer.trim();
  const fenced = /^```[^\n]*\n([\s\S]*)\n```$/.exec(trimmed);
  if (!fenced) return trimmed;
  // A fence that closes and reopens means several blocks, so the outer pair was
  // never a wrapper: the first block simply started at the top.
  return fenced[1].includes('```') ? trimmed : fenced[1].trim();
}
