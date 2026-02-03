import type { TicketRef } from '@repo/shared';

/**
 * Turns the ticket references in a rendered changelog into links.
 *
 * The convention's own writer links `#42` to the repository's issues and knows
 * nothing else: a `OPS-123` claimed by a Jira tracker comes out as plain text,
 * because the rules that recognised it live here and not in the parser. So the
 * keys are linked afterwards, from what the extraction already found on each
 * entry — no second reading of the commits, and no rule applied twice.
 *
 * Done on the text rather than inside the writer because the writer's own
 * linking is a template expanded per commit, and there is no seam in it for a
 * second source of links.
 */
export function linkTickets(markdown: string, tickets: readonly TicketRef[]): string {
  const byKey = new Map<string, string>();
  for (const ticket of tickets) {
    // The first URL a key was given wins, which is the one the highest-priority
    // rule built — the same precedence the extraction applied.
    if (ticket.url && !byKey.has(ticket.key)) byKey.set(ticket.key, ticket.url);
  }
  if (byKey.size === 0) return markdown;

  // Longest first: with both `OPS-1` and `OPS-12` known, the shorter one would
  // otherwise claim the start of the longer.
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);

  /**
   * Two alternatives, and the order is the whole trick: what must be left alone
   * is matched *first*, so a key inside inline code or inside a link somebody
   * already wrote is consumed by the first group and handed back untouched.
   * Without it, linking `[OPS-1](…)` again would nest one link in another.
   */
  const pattern = new RegExp(
    `(\`[^\`]*\`|\\[[^\\]]*\\]\\([^)]*\\))|(?<![\\w-])(${keys.join('|')})(?![\\w-])`,
    'g',
  );

  return markdown.replace(pattern, (whole, protectedRun: string | undefined, key: string) =>
    protectedRun ? protectedRun : `[${key}](${byKey.get(key)})`,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
