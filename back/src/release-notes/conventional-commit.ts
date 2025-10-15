/** What a Conventional Commits subject line yields, once parsed. */
export interface ParsedCommit {
  /** Lowercased: `Feat` and `feat` are the same section. */
  type: string;
  scope: string | null;
  breaking: boolean;
  summary: string;
}

/**
 * `type(scope)!: summary`, where the scope and the `!` are optional.
 * Anchored and deliberately narrow: a subject that merely contains a colon —
 * "Revert: fix login" — is not a conventional commit, and treating it as one
 * would invent a type named `Revert`.
 */
const SUBJECT = /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?:\s+(?<summary>.+)$/;

/** A body line marking a breaking change, per the specification. */
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:\s*(?<detail>.+)$/m;

/**
 * Reads a commit message as a Conventional Commit, or returns null when it
 * follows no convention — which is the common case in most histories and has to
 * stay usable rather than be dropped.
 *
 * A breaking change is flagged either by the `!` before the colon or by a
 * `BREAKING CHANGE:` footer; the specification allows both, and projects use
 * both. When the footer carries a description, it replaces the subject: it is
 * written for the reader of the release notes, the subject for the reviewer.
 */
export function parseConventionalCommit(message: string): ParsedCommit | null {
  const [subject = '', ...body] = message.split('\n');
  const match = SUBJECT.exec(subject.trim());
  if (!match?.groups) return null;

  const footer = BREAKING_FOOTER.exec(body.join('\n'));
  const scope = match.groups.scope?.trim();

  return {
    type: match.groups.type.toLowerCase(),
    scope: scope ? scope : null,
    breaking: Boolean(match.groups.bang) || footer !== null,
    summary: footer?.groups?.detail.trim() || match.groups.summary.trim(),
  };
}

/**
 * Section order in the rendered notes. What a reader needs first comes first;
 * anything outside this list keeps its type and follows, so an unusual
 * convention is listed rather than swallowed.
 */
export const SECTION_ORDER = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore'];

/** Ranks a type for display: known ones in order, the rest after, then `other`. */
export function sectionRank(type: string): number {
  if (type === 'other') return SECTION_ORDER.length + 1;
  const known = SECTION_ORDER.indexOf(type);
  return known === -1 ? SECTION_ORDER.length : known;
}
