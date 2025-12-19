import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import type {
  Branch,
  Commit,
  ReleaseNoteEntry,
  ReleaseNoteSection,
  ReleaseNotes,
  RewriteResult,
  Tag,
} from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import { SourcesService } from '../sources/sources.service';
import { ConnectorFactory } from '../sources/connectors/connector.factory';
import { TicketRulesService } from '../ticket-rules/ticket-rules.service';
import { LlmService } from '../llm/llm.service';
import { ReaderFactory } from '../ingest/reader.factory';
import { SettingsService } from '../settings/settings.service';
import { parseConventionalCommit, sectionRank } from './conventional-commit';
import { renderChangelog } from './changelog';
import { resolveRange } from './range';
import { refUrl, type RepoLocation } from '../sources/connectors/ref-url';
import { REWRITE_SYSTEM, buildRewritePrompt, readRewritten } from './rewrite';
import type { RewriteReleaseNotesDto } from './dto/rewrite-release-notes.dto';

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
    private readonly llm: LlmService,
    private readonly readers: ReaderFactory,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Repos in the source's scope, for whoever picks the one to summarise. Goes
   * through the reader rather than the connector: a `stored` source answers
   * this from its own table, without spending a call on a list it already has.
   */
  async repos(sourceId: string, signal?: AbortSignal): Promise<string[]> {
    const reader = await this.readers.for(sourceId, signal);
    return reader.listRepositories();
  }

  /**
   * Rewrites generated notes through a declared model provider. The notes come
   * in with the request: regenerating them would replay the whole burst of
   * connector calls to arrive at the text the caller already has.
   *
   * The Markdown is the only thing sent to the vendor — no token, no repo
   * listing, nothing about the source beyond what the notes already say.
   */
  async rewrite(dto: RewriteReleaseNotesDto, signal?: AbortSignal): Promise<RewriteResult> {
    const answer = await this.llm.complete(
      dto.providerId,
      {
        system: REWRITE_SYSTEM,
        prompt: buildRewritePrompt(dto.markdown, dto.language),
      },
      signal,
    );
    this.logger.log(
      `Notes de version reformulées par ${answer.provider.name} (${answer.provider.model})`,
    );
    return {
      markdown: readRewritten(answer.text),
      providerId: answer.provider.id,
      providerName: answer.provider.name,
      model: answer.provider.model,
    };
  }

  /** Tags of a repo, for whoever picks the range. */
  async tags(sourceId: string, repo: string, signal?: AbortSignal): Promise<Tag[]> {
    const { ctx, kind } = await this.sources.resolveContext(sourceId, signal);
    return this.connectors.for(kind).listTags(ctx, repo);
  }

  /**
   * Branches of a repo — the other kind of bound a range may have. Kept apart
   * from `tags` rather than merged into one call: the two are picked from the
   * same control but they are not the same thing, and a repo may have hundreds
   * of one and none of the other.
   */
  async branches(sourceId: string, repo: string, signal?: AbortSignal): Promise<Branch[]> {
    const { ctx, kind } = await this.sources.resolveContext(sourceId, signal);
    return this.connectors.for(kind).listBranches(ctx, repo);
  }

  async generate(
    sourceId: string,
    query: ReleaseNotesQuery,
    signal?: AbortSignal,
  ): Promise<ReleaseNotes> {
    const { ctx, kind } = await this.sources.resolveContext(sourceId, signal);
    const connector = this.connectors.for(kind);
    const tags = await connector.listTags(ctx, query.repo);

    const { from, to } = await resolveRange(query, tags, () =>
      connector.defaultBranch(ctx, query.repo),
    );
    const commits = await connector.listCommitsBetween(ctx, query.repo, from, to);
    const entries = await this.toEntries(sourceId, ctx.scope.owner, query.repo, commits);

    const sections = groupByType(entries);
    const breaking = entries
      .filter(({ entry }) => entry.breaking)
      .map(({ entry }) => entry);

    // Built rather than read: what a bound points at is derivable from the
    // platform and the repo, and the front must not learn which platform.
    const location: RepoLocation = {
      kind,
      baseUrl: ctx.baseUrl,
      owner: ctx.scope.owner,
      repo: query.repo,
    };
    const generator = (await this.settings.get()).releaseNotesGenerator;
    return {
      repo: query.repo,
      from,
      to,
      fromUrl: from === null ? null : refUrl(location, from),
      toUrl: refUrl(location, to),
      sections,
      breaking,
      markdown:
        generator === 'conventional-changelog'
          ? await renderChangelog(
              location,
              from,
              to,
              entries.map(({ entry }) => entry),
            )
          : render(query.repo, from, to, sections, breaking),
      generator,
    };
  }

  /**
   * Parses each commit and attaches the tickets its message mentions, dropping
   * the Conventional Commits type — what a caller wants when it has a range of
   * its own to describe rather than a release to file.
   *
   * Public because the deployments page asks the same question of a different
   * range: what a ref carries over another one is the same reading of the same
   * commits, and two readings of a commit message would drift.
   */
  async describeCommits(
    sourceId: string,
    owner: string,
    repo: string,
    commits: Commit[],
  ): Promise<ReleaseNoteEntry[]> {
    const entries = await this.toEntries(sourceId, owner, repo, commits);
    return entries.map(({ entry }) => entry);
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
          // Carried whole beside the parsed line: the body is where a commit
          // says why, and no reading above keeps a word of it.
          message: commit.message,
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
