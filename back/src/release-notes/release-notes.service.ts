import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import type {
  Branch,
  Commit,
  PullRequestRef,
  ReleaseNoteEntry,
  ReleaseNoteSection,
  ReleaseNotes,
  ReleaseNotesGenerator,
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
import type {
  CommitPullRequest,
  ConnectorContext,
  SourceConnector,
} from '../sources/connectors/source-connector.interface';
import { parseConventionalCommit, sectionRank } from './conventional-commit';
import { readMergeCommit } from './merge-commit';
import { renderChangelog } from './changelog';
import { linkTickets } from './link-tickets';
import { resolveRange, tagsMatching } from './range';
import { refUrl, requestUrl, type RepoLocation } from '../sources/connectors/ref-url';
import { REWRITE_SYSTEM, buildRewritePrompt, readRewritten } from './rewrite';
import type { RewriteReleaseNotesDto } from './dto/rewrite-release-notes.dto';

/**
 * A commit with the request it came in on — what an expansion rewrites.
 *
 * The two travel together because expanding replaces one commit with several,
 * and each of those came in on the request its squash named: two positional
 * arrays would have to be kept in step through an operation whose whole purpose
 * is to change how many there are.
 */
interface Landed {
  commit: Commit;
  ref: PullRequestRef | null;
  branch: string | null;
  /** The request's title and description, when a rule asked for them. */
  title: string | null;
  body: string | null;
}

/** What to summarise: a repo, and the range within it. */
export interface ReleaseNotesQuery {
  repo: string;
  /** Omitted, the tag before `to` — or the whole history when there is none. */
  from?: string;
  /** Omitted, the most recent tag, or the default branch when none exists. */
  to?: string;
  /**
   * Which tags count as releases of the thing being summarised — `^front@`, on
   * a repo that also tags `api@…`. Omitted, every tag does, which is the right
   * answer for a repo holding one deployable.
   */
  tagPattern?: string;
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
      `Release notes rewritten by ${answer.provider.name} (${answer.provider.model})`,
    );
    return {
      markdown: readRewritten(answer.text),
      providerId: answer.provider.id,
      providerName: answer.provider.name,
      model: answer.provider.model,
    };
  }

  /**
   * Tags of a repo, for whoever picks the range. `pattern` narrows them to one
   * component's releases — the picker then offers what the defaults would
   * choose from, which is the only way the two can agree on a monorepo.
   */
  async tags(
    sourceId: string,
    repo: string,
    pattern?: string,
    signal?: AbortSignal,
  ): Promise<Tag[]> {
    const { ctx, kind } = await this.sources.resolveContext(sourceId, signal);
    return tagsMatching(await this.connectors.for(kind).listTags(ctx, repo), pattern);
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
    // Narrowed before the defaults are applied, never after: every one of them
    // reads "the most recent tag", and on a monorepo that is whichever
    // component released last unless this has already spoken.
    const tags = tagsMatching(await connector.listTags(ctx, query.repo), query.tagPattern);

    const { from, to } = await resolveRange(query, tags, () =>
      connector.defaultBranch(ctx, query.repo),
    );
    // Built rather than read: what a bound points at is derivable from the
    // platform and the repo, and the front must not learn which platform.
    const location: RepoLocation = {
      kind,
      baseUrl: ctx.baseUrl,
      owner: ctx.scope.owner,
      repo: query.repo,
    };
    const commits = await connector.listCommitsBetween(ctx, query.repo, from, to);
    const entries = await this.toEntries(sourceId, connector, ctx, location, commits);
    const { markdown, generator } = await this.render(location, from, to, entries);

    return {
      repo: query.repo,
      from,
      to,
      fromUrl: from === null ? null : refUrl(location, from),
      toUrl: refUrl(location, to),
      sections: groupByType(entries),
      breaking: entries.filter((entry) => entry.breaking),
      markdown,
      generator,
    };
  }

  /**
   * A range of entries as Markdown, through the generator the install chose.
   *
   * Public for the same reason `describeCommits` is: a deployment is a range
   * too — one ref against another — and the text describing what went out has
   * to be the text a release note would have given for the same commits.
   */
  async render(
    location: RepoLocation,
    from: string | null,
    to: string,
    entries: ReleaseNoteEntry[],
  ): Promise<{ markdown: string; generator: ReleaseNotesGenerator }> {
    const generator = (await this.settings.get()).releaseNotesGenerator;
    const markdown =
      generator === 'conventional-changelog'
        ? await renderChangelog(location, from, to, entries)
        : // Linked afterwards for the same reason the other generator is: the
          // bullet lists the tickets an entry carries, and a key written in the
          // summary itself is the same reference, owed the same link.
          linkTickets(
            render(
              location.repo,
              from,
              to,
              groupByType(entries),
              entries.filter((entry) => entry.breaking),
            ),
            entries.flatMap((entry) => entry.tickets),
          );
    return { markdown, generator };
  }

  /**
   * Parses each commit and attaches the tickets it references, dropping the
   * Conventional Commits type — what a caller wants when it has a range of its
   * own to describe rather than a release to file.
   *
   * Public because the deployments page asks the same question of a different
   * range: what a ref carries over another one is the same reading of the same
   * commits, and two readings of a commit message would drift.
   *
   * The connector comes from the caller rather than from the factory here: both
   * callers have already resolved one to list the commits being described, and
   * the lookup below has to be billed to that same context.
   */
  async describeCommits(
    sourceId: string,
    connector: SourceConnector,
    ctx: ConnectorContext,
    location: RepoLocation,
    commits: Commit[],
  ): Promise<ReleaseNoteEntry[]> {
    return this.toEntries(sourceId, connector, ctx, location, commits);
  }

  /**
   * Parses each commit, links the request that brought it in, and attaches the
   * tickets it references — in its own message, and in that request's branch.
   */
  private async toEntries(
    sourceId: string,
    connector: SourceConnector,
    ctx: ConnectorContext,
    location: RepoLocation,
    commits: Commit[],
  ): Promise<ReleaseNoteEntry[]> {
    const requests = await this.requestsOf(sourceId, connector, ctx, location, commits);
    const landed = await this.expandSquashes(
      connector,
      ctx,
      location,
      commits.map((commit, i) => ({ commit, ...requests[i] })),
    );
    // One text per source a rule may read. The commit message is its own text
    // rather than the request's title: a squash copies the title into the
    // message, but a commit pushed straight to a branch has no request at all,
    // and a rule confined to titles must not match what it never read.
    const tickets = await this.ticketRules.extractMany(
      sourceId,
      landed.map(({ commit, branch, title, body }) => ({
        branch: branch ?? '',
        title: title ?? '',
        body: body ?? '',
        commit: commit.message,
      })),
      landed.map(() => ({ owner: ctx.scope.owner, repo: location.repo })),
    );

    return landed.map(({ commit, ref }, i) => {
      const parsed = parseConventionalCommit(commit.message);
      return {
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
        pullRequest: ref,
      };
    });
  }

  /**
   * Replaces each squashed commit with the commits it was made of.
   *
   * Squashing is what makes a range under-report: it collapses a branch into a
   * single commit, so the work that went into it is nowhere in the history the
   * range walks. It survives only on the request, which both platforms keep
   * answering for long after the branch is deleted.
   *
   * A merge commit is deliberately left alone: the commits it brought in *are*
   * in the range, being reachable from the head that was compared, so fetching
   * them would pay a call for what is already in hand — and then have to
   * recognise them as duplicates.
   *
   * What counts as a squash is a one-parent commit **whose own message names a
   * request**, which is the shape the platform writes. Deliberately not "any
   * commit we found a request for": the association answers for every commit of
   * every request, so that reading would expand the whole range, spend a call
   * per request and arrive back where it started.
   */
  private async expandSquashes(
    connector: SourceConnector,
    ctx: ConnectorContext,
    location: RepoLocation,
    landed: Landed[],
  ): Promise<Landed[]> {
    const squashed = landed.filter(
      ({ commit }) =>
        commit.parents === 1 && readMergeCommit(commit.message, location.kind).number !== null,
    );
    if (squashed.length === 0) return landed;

    const numbers = [...new Set(squashed.map(({ ref }) => ref?.number).filter(isNumber))];
    const byRequest = await connector.pullRequestCommits(ctx, location.repo, numbers);
    if (byRequest.size === 0) return landed;

    const squashes = new Set(squashed.map(({ commit }) => commit.sha));
    const seen = new Set(landed.map(({ commit }) => commit.sha));
    const out: Landed[] = [];
    for (const entry of landed) {
      const children = squashes.has(entry.commit.sha)
        ? byRequest.get(entry.ref?.number ?? -1)
        : undefined;
      // Only what the range does not already hold: a commit listed twice would
      // be counted twice, by the summary as much as by a reader.
      const fresh = children?.filter(({ sha }) => !seen.has(sha)) ?? [];
      if (fresh.length === 0) {
        // Nothing came back, or nothing new did — which includes a request the
        // reserve made us give up on. The commit stands as it was written.
        out.push(entry);
        continue;
      }
      for (const commit of fresh) {
        seen.add(commit.sha);
        // The children inherit the request their squash named: they came in on
        // it, and resolving it again per commit would be a call each.
        out.push({ ...entry, commit });
      }
    }
    return out;
  }

  /**
   * The request each commit came in on, positional with `commits`: what to link
   * it to, and the texts to extract tickets from. Any part may be missing, and
   * all of them are for a commit pushed straight to a branch.
   *
   * Two sources, cheapest first. A merge commit names its request in its own
   * message, which costs nothing to read — number and branch on a generated
   * merge, number alone on a squash, which kept no branch to name. Everything
   * else has to be asked for, one call per commit.
   *
   * What is still worth a call is therefore per commit, not per range: the
   * number is always wanted, since it is the link; the other texts only when a
   * ticket rule reaching this source declares it reads them, or they would be
   * extracted from for nobody. A squashed history with no tracker configured
   * thus costs nothing at all, and rules confined to the commit message keep it
   * that way — which is the point of letting a rule say what it reads.
   *
   * A title or a description is never in the commit message, so wanting either
   * is a call for every commit. That is the price of the option, paid only by
   * the installs that tick it.
   */
  private async requestsOf(
    sourceId: string,
    connector: SourceConnector,
    ctx: ConnectorContext,
    location: RepoLocation,
    commits: Commit[],
  ): Promise<
    Array<{
      ref: PullRequestRef | null;
      branch: string | null;
      title: string | null;
      body: string | null;
    }>
  > {
    const read = commits.map((commit) => readMergeCommit(commit.message, location.kind));
    const wanted = await this.ticketRules.sourcesFor(sourceId);
    const wantsBranch = wanted.has('branch');
    const wantsRequestText = wanted.has('title') || wanted.has('body');
    const unresolved = commits.filter(
      (_, i) =>
        read[i].number === null || wantsRequestText || (wantsBranch && read[i].branch === null),
    );

    const resolved = unresolved.length
      ? await connector.commitPullRequests(
          ctx,
          location.repo,
          unresolved.map((commit) => commit.sha),
        )
      : new Map<string, CommitPullRequest>();

    return commits.map((commit, i) => {
      const found = resolved.get(commit.sha);
      // The message wins on the number it gave: it is the same request either
      // way, and its URL is derived from the same platform and repo the
      // association would have answered.
      const number = read[i].number ?? found?.number ?? null;
      return {
        ref: number === null ? null : { number, url: requestUrl(location, number) },
        branch: read[i].branch ?? found?.headRef ?? null,
        title: found?.title ?? null,
        body: found?.body ?? null,
      };
    });
  }
}

function firstLine(message: string): string {
  return message.split('\n')[0].trim();
}

/**
 * Entries in sections, by Conventional Commits type.
 *
 * The type is read back off the message rather than carried alongside the
 * entry: the message is kept whole precisely so nothing above has to be the
 * only reading of it, and a section this disagreed with the summary about would
 * be a bug nobody could see.
 */
function groupByType(entries: ReleaseNoteEntry[]): ReleaseNoteSection[] {
  const byType = new Map<string, ReleaseNoteEntry[]>();
  for (const entry of entries) {
    // A history following no convention still has to be listed.
    const type = parseConventionalCommit(entry.message)?.type ?? 'other';
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

/**
 * One entry, with what a reader verifies it against: the tickets it references,
 * the request it was reviewed in, and the commit itself. In that order — what
 * the change was *for*, then where it was discussed, then what it actually did.
 */
function bullet(entry: ReleaseNoteEntry): string {
  const scope = entry.scope ? `**${entry.scope}**: ` : '';
  const tickets = entry.tickets.map((t) => (t.url ? `[${t.key}](${t.url})` : t.key)).join(', ');
  const request = entry.pullRequest
    ? `[#${entry.pullRequest.number}](${entry.pullRequest.url})`
    : '';
  const refs = [tickets, request, `[\`${entry.sha.slice(0, 7)}\`](${entry.url})`]
    .filter(Boolean)
    .join(' · ');
  return `- ${scope}${entry.summary} — ${refs}`;
}

/** Narrows away the requests a commit never named. */
function isNumber(value: number | undefined): value is number {
  return value !== undefined;
}
