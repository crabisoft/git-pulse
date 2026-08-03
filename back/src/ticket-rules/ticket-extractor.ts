import {
  TICKET_SOURCES,
  TRACKER_URL_TEMPLATES,
  type TicketRef,
  type TicketRefTracker,
  type TicketSource,
} from '@repo/shared';

/** The tracker a rule points at, with what building a link needs. */
export interface TicketRuleTracker extends TicketRefTracker {
  baseUrl: string;
  /** Null falls back to the shape derived from `kind`. */
  urlTemplate: string | null;
}

export interface TicketRuleLike {
  name: string;
  pattern: string;
  /** The texts this rule reads. A rule reading none of them is skipped. */
  sources: TicketSource[];
  priority: number;
  tracker: TicketRuleTracker;
}

/**
 * The texts a reference is looked for in. All optional: a caller supplies the
 * ones it holds, and a rule reading a text nobody supplied simply finds
 * nothing there — a pull request's description is not available everywhere a
 * pull request is.
 */
export type TicketTexts = Partial<Record<TicketSource, string>>;

/**
 * Where the pull request lives. Git-hosted trackers need it: `#42` only
 * resolves into a URL with the repo it was filed against, which changes from
 * one PR to the next.
 */
export interface TicketOrigin {
  owner: string;
  repo: string;
}

/**
 * Extracts every ticket reference a PR carries.
 *
 * The key is the `key` named group, or the whole match when the pattern defines
 * none. Matching is global: a PR referencing two tickets yields both. The same
 * key found twice — typically in the branch *and* the title — is kept once,
 * attributed to the text it was seen in first.
 *
 * Each rule reads only the texts it declares. That is what keeps a pattern
 * loose enough to be useful in one place from matching everything in another:
 * `\d+` on a branch is a ticket number, and on a description it is any figure
 * somebody typed.
 *
 * On conflict, the lower priority number wins: it decides which tracker a key
 * belongs to when two rules claim it. Invalid patterns are skipped rather than
 * throwing, exactly like the classification engine.
 */
export function extractTickets(
  texts: TicketTexts,
  rules: TicketRuleLike[],
  origin?: TicketOrigin,
): TicketRef[] {
  const found = new Map<string, { ref: TicketRef; priority: number }>();

  for (const rule of [...rules].sort((a, b) => a.priority - b.priority)) {
    const regex = safeRegExp(rule.pattern);
    if (!regex) continue;

    // The declared order, not the stored one: a rule saved as `title, branch`
    // must attribute a key to the branch all the same, or the same rule set
    // would report a different origin depending on how it was typed in.
    for (const foundIn of TICKET_SOURCES) {
      if (!rule.sources.includes(foundIn)) continue;
      const text = texts[foundIn];
      if (!text) continue;
      for (const match of text.matchAll(regex)) {
        const key = match.groups?.key ?? match[0];
        if (!key) continue;
        const existing = found.get(key);
        // A key already seen keeps its first attribution, unless a
        // higher-priority rule claims it for another tracker.
        if (existing && existing.priority <= rule.priority) continue;
        const url = buildUrl(rule.tracker, key, origin);
        found.set(key, {
          priority: rule.priority,
          ref: {
            key,
            ...(url ? { url } : {}),
            foundIn,
            tracker: { id: rule.tracker.id, name: rule.tracker.name, kind: rule.tracker.kind },
          },
        });
      }
    }
  }

  // Discovery order, which carries meaning: highest-priority rule first, and
  // within a rule the branch before the title. The PR's main ticket therefore
  // comes first, where sorting by key would have buried it under a `#42`.
  return [...found.values()].map(({ ref }) => ref);
}

/**
 * Fills the tracker's template. Returns null when a placeholder cannot be
 * resolved — a git-hosted tracker previewed outside any pull request, say —
 * rather than emitting a URL with a hole in it.
 */
export function buildUrl(
  tracker: TicketRuleTracker,
  key: string,
  origin?: TicketOrigin,
): string | null {
  const template = tracker.urlTemplate || TRACKER_URL_TEMPLATES[tracker.kind];
  const values: Record<string, string | undefined> = {
    base: tracker.baseUrl.replace(/\/$/, ''),
    // Encoded as a value: a key may carry characters a path would swallow.
    key: encodeURIComponent(key),
    // Left raw: both are path segments, and a GitLab repo is `group/sub/project`
    // whose slashes are separators, not content to escape.
    owner: origin?.owner,
    repo: origin?.repo,
  };

  let missing = false;
  const url = template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing = true;
      return whole;
    }
    return value;
  });
  return missing ? null : url;
}

/**
 * Compiled global so `matchAll` walks the whole text — a lone `exec` would stop
 * at the first ticket. `matchAll` requires the flag and throws without it.
 */
function safeRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'g');
  } catch {
    return null;
  }
}
