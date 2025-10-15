import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import type { Commit, ReleaseNoteEntry, ReleaseNoteSection, ReleaseNotes, Tag } from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import { SourcesService } from '../sources/sources.service';
import { ConnectorFactory } from '../sources/connectors/connector.factory';
import { TicketRulesService } from '../ticket-rules/ticket-rules.service';
import { parseConventionalCommit, sectionRank } from './conventional-commit';

/** What to summarise: a repo, and the range within it. */
export interface ReleaseNotesQuery {
  repo: string;
  /** Omitted, the tag before `to` — or the whole history when there is none. */
  from?: string;
  /** Omitted, the most recent tag, or the default branch when none exists. */
  to?: string;
}

@Injectable()
export class ReleaseNotesService {
  private readonly logger = new Logger(ReleaseNotesService.name);

  constructor(
    private readonly sources: SourcesService,
    private readonly connectors: ConnectorFactory,
    private readonly ticketRules: TicketRulesService,
  ) {}

  /** Tags of a repo, for whoever picks the range. */
  async tags(sourceId: string, repo: string, signal?: AbortSignal): Promise<Tag[]> {
    const { ctx, kind } = await this.sources.resolveContext(sourceId, signal);
    return this.connectors.for(kind).listTags(ctx, repo);
  }

  async generate(
    sourceId: string,
    query: ReleaseNotesQuery,
    signal?: AbortSignal,
  ): Promise<ReleaseNotes> {
    const { ctx, kind } = await this.sources.resolveContext(sourceId, signal);
    const connector = this.connectors.for(kind);
    const tags = await connector.listTags(ctx, query.repo);

    const { from, to } = await this.resolveRange(query, tags, () =>
      connector.defaultBranch(ctx, query.repo),
    );
    const commits = await connector.listCommitsBetween(ctx, query.repo, from, to);
    const entries = await this.toEntries(sourceId, ctx.scope.owner, query.repo, commits);

    const sections = groupByType(entries);
    const breaking = entries
      .filter(({ entry }) => entry.breaking)
      .map(({ entry }) => entry);

    return {
      repo: query.repo,
      from,
      to,
      sections,
      breaking,
      markdown: render(query.repo, from, to, sections, breaking),
    };
  }

  /**
   * Fills the bounds in. `to` defaults to the most recent tag so a release is
   * summarised as it was cut, not as the branch has drifted since; `from` to
   * the tag before it, which is the range a reader expects.
   */
  private async resolveRange(
    query: ReleaseNotesQuery,
    tags: Tag[],
    defaultBranch: () => Promise<string>,
  ): Promise<{ from: string | null; to: string }> {
    const to = query.to ?? tags[0]?.name ?? (await defaultBranch());
    if (query.from) return { from: query.from, to };

    // The tag just below `to` in the platform's own ordering. Absent — a first
    // release, or a branch head — the range starts at the beginning of history.
    const index = tags.findIndex((tag) => tag.name === to);
    const previous = index === -1 ? tags[0] : tags[index + 1];
    return { from: previous?.name ?? null, to };
  }

  /** Parses each commit and attaches the tickets its message mentions. */
  private async toEntries(
    sourceId: string,
    owner: string,
    repo: string,
    commits: Commit[],
  ): Promise<Array<{ type: string; entry: ReleaseNoteEntry }>> {
    const tickets = await this.ticketRules.extractMany(
      sourceId,
      // Release notes have no branch: the message is the only text there is.
      commits.map((c) => ({ branch: '', title: c.message })),
      commits.map(() => ({ owner, repo })),
    );

    return commits.map((commit, i) => {
      const parsed = parseConventionalCommit(commit.message);
      return {
        // A history following no convention still has to be listed.
        type: parsed?.type ?? 'other',
        entry: {
          summary: parsed?.summary ?? firstLine(commit.message),
          scope: parsed?.scope ?? null,
          breaking: parsed?.breaking ?? false,
          sha: commit.sha,
          author: commit.author,
          url: commit.url,
          tickets: tickets[i],
        },
      };
    });
  }
}

function firstLine(message: string): string {
  return message.split('\n')[0].trim();
}

function groupByType(
  entries: Array<{ type: string; entry: ReleaseNoteEntry }>,
): ReleaseNoteSection[] {
  const byType = new Map<string, ReleaseNoteEntry[]>();
  for (const { type, entry } of entries) {
    const bucket = byType.get(type);
    if (bucket) bucket.push(entry);
    else byType.set(type, [entry]);
  }
  return [...byType.entries()]
    .map(([type, sectionEntries]) => ({ type, entries: sectionEntries }))
    .sort((a, b) => sectionRank(a.type) - sectionRank(b.type) || a.type.localeCompare(b.type));
}

/**
 * Markdown, ready to paste into a release. Breaking changes lead: they are what
 * a reader upgrading needs before anything else.
 */
function render(
  repo: string,
  from: string | null,
  to: string,
  sections: ReleaseNoteSection[],
  breaking: ReleaseNoteEntry[],
): string {
  const range = from ? `${from}...${to}` : to;
  const lines = [`## ${repo} — ${range}`, ''];

  if (breaking.length > 0) {
    lines.push('### ⚠ Breaking changes', '');
    for (const entry of breaking) lines.push(bullet(entry));
    lines.push('');
  }

  for (const section of sections) {
    lines.push(`### ${section.type}`, '');
    for (const entry of section.entries) lines.push(bullet(entry));
    lines.push('');
  }

  if (sections.length === 0) lines.push('_No change in this range._', '');
  return lines.join('\n');
}

function bullet(entry: ReleaseNoteEntry): string {
  const scope = entry.scope ? `**${entry.scope}**: ` : '';
  const tickets = entry.tickets.map((t) => (t.url ? `[${t.key}](${t.url})` : t.key)).join(', ');
  const refs = [tickets, `[\`${entry.sha.slice(0, 7)}\`](${entry.url})`].filter(Boolean).join(' · ');
  return `- ${scope}${entry.summary} — ${refs}`;
}
