import type { TicketRef } from '@repo/shared';

/**
 * Links the ticket references of a rendered changelog, and only those.
 *
 * Two jobs, both following from the same decision: what a reference points at
 * is settled by the ticket rules, not by whoever rendered the text.
 *
 * The first is to link what the rules recognised. A `OPS-123` claimed by a Jira
 * tracker comes out of the convention's writer as plain text, because the rules
 * that recognised it live here and not in the parser. So the keys are linked
 * afterwards, from what the extraction already found on each entry — no second
 * reading of the commits, and no rule applied twice.
 *
 * The second is to undo what the writer decided on its own. It links every
 * `#42` to the repository's issues, knowing nothing of the trackers a team
 * actually files against, and a key it has already linked cannot be linked
 * again. `defaults` names those links so a claimed key can be pointed at its
 * real tracker, and an unclaimed one handed back as text rather than sent to an
 * issue nobody opened.
 *
 * Done on the text rather than inside the writer because the writer's own
 * linking is a template expanded per commit, and there is no seam in it for a
 * second source of links.
 */
export interface DefaultLinks {
  /**
   * URL prefix the renderer's own reference links carry. What identifies them:
   * a link somebody wrote in a commit message must survive untouched.
   */
  prefix: string;
  /**
   * The default links worth keeping, by the text they were written under. The
   * requests of the range, typically: `#42` in a squashed subject is the pull
   * request it landed in, which is a link the notes should keep even though no
   * ticket rule claims it.
   */
  keep: ReadonlyMap<string, string>;
}

export function linkTickets(
  markdown: string,
  tickets: readonly TicketRef[],
  defaults?: DefaultLinks,
): string {
  const byKey = new Map<string, string>();
  for (const ticket of tickets) {
    // The first URL a key was given wins, which is the one the highest-priority
    // rule built — the same precedence the extraction applied.
    if (ticket.url && !byKey.has(ticket.key)) byKey.set(ticket.key, ticket.url);
  }
  if (byKey.size === 0 && !defaults) return markdown;

  // Longest first: with both `OPS-1` and `OPS-12` known, the shorter one would
  // otherwise claim the start of the longer.
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);

  /**
   * Three alternatives, and the order is the whole trick. Inline code comes
   * first, so a key being quoted rather than referenced is consumed and handed
   * back. Then whole links, which is how a key already linked is reconsidered
   * as a link instead of being nested inside another one. The bare key comes
   * last, and only when there is one to look for.
   */
  const hasKeys = keys.length > 0;
  const pattern = new RegExp(
    '(`[^`]*`)|\\[([^\\]]*)\\]\\(([^)]*)\\)' +
      (hasKeys ? `|(?<![\\w-])(${keys.join('|')})(?![\\w-])` : ''),
    'g',
  );

  return markdown.replace(
    pattern,
    (
      whole: string,
      code: string | undefined,
      linked: string | undefined,
      url: string | undefined,
      // Only a group when there are keys to look for. Without one, `replace`
      // hands the match offset in its place, which is a number that reads as a
      // perfectly good key right up until it is linked.
      fourth: string | number | undefined,
    ) => {
      if (code !== undefined) return whole;
      const bare = hasKeys && typeof fourth === 'string' ? fourth : undefined;
      if (bare !== undefined) return `[${bare}](${byKey.get(bare)})`;
      if (linked === undefined || url === undefined) return whole;

      const claimed = byKey.get(linked);
      if (claimed) return `[${linked}](${claimed})`;
      // Only the renderer's own links are reconsidered. Anything else was
      // written by a person, who meant it.
      if (!defaults || !url.startsWith(defaults.prefix)) return whole;
      const kept = defaults.keep.get(linked);
      return kept ? `[${linked}](${kept})` : linked;
    },
  );
}

/**
 * Whether a text already names a key — the same reading the linking above does,
 * so that "already mentioned" and "would have been linked" can never disagree.
 * A key inside a link somebody wrote counts: it is a mention either way.
 */
export function mentionsKey(text: string, key: string): boolean {
  return new RegExp(`(?<![\\w-])${escapeRegExp(key)}(?![\\w-])`).test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
