import type { Transform } from 'node:stream';
import writer from 'conventional-changelog-writer';
import { sync as parseCommit } from 'conventional-commits-parser';
import createPreset from 'conventional-changelog-conventionalcommits';
import type { ReleaseNoteEntry } from '@repo/shared';
import { repoUrl, type RepoLocation } from '../sources/connectors/ref-url';
import { linkTickets, mentionsKey } from './link-tickets';

/**
 * The other renderer: the range handed to the `conventional-changelog` packages
 * rather than to the Markdown built in this module.
 *
 * The point is not to save the twenty lines the built-in renderer takes. It is
 * that a repo holding the Conventional Commits convention gets the layout the
 * convention's own tooling produces — the section titles everyone recognises,
 * the breaking changes as notes, the reference links — and gets it from the
 * package that defines it rather than from our reading of the specification.
 *
 * What that costs is stated where it is chosen: the preset drops any commit it
 * cannot parse, so a history that only half follows the convention comes out
 * half listed. The structured sections the page renders are unaffected, which
 * is what makes the difference visible instead of silent.
 */

/**
 * Every type the preset knows, none of them hidden.
 *
 * The preset publishes only `feat`, `fix`, `perf` and `revert` by default: it
 * writes CHANGELOGs for package consumers, who have no use for a `chore`. These
 * notes are read by the team that wrote the commits, and a generator that
 * quietly swallowed every `refactor` would be a downgrade, not an opinion. The
 * grouping and the titles — which is what the package is here for — are kept
 * exactly as it defines them.
 */
const TYPES = createPreset.DEFAULT_COMMIT_TYPES.map(({ type, section }) => ({ type, section }));

/** Where a platform hangs the pages the notes link to, under the repo URL. */
const PATHS = {
  github: { commit: 'commit', issue: 'issues', compare: 'compare' },
  gitlab: { commit: '-/commit', issue: '-/issues', compare: '-/compare' },
} as const;

/**
 * Renders a range the way the convention's tooling does.
 *
 * The entries come in already read once — the same ones the page lists — so the
 * two readings describe the same commits. Only the whole message is handed to
 * the parser: everything else it would infer is already known here.
 */
export async function renderChangelog(
  location: RepoLocation,
  from: string | null,
  to: string,
  entries: ReleaseNoteEntry[],
): Promise<string> {
  const paths = PATHS[location.kind];
  const root = repoUrl(location);
  const preset = await createPreset({
    types: TYPES,
    // The formats are expanded against the context below, where `host` carries
    // the whole repo URL: it is already built for the platform in hand — public
    // GitHub included — and building it twice is how the two drift apart.
    commitUrlFormat: `{{host}}/${paths.commit}/{{hash}}`,
    issueUrlFormat: `{{host}}/${paths.issue}/{{id}}`,
    compareUrlFormat: `{{host}}/${paths.compare}/{{previousTag}}...{{currentTag}}`,
  });

  const commits = entries.map((entry) => ({
    ...parseCommit(entry.message, preset.parserOpts),
    hash: entry.sha,
  }));

  const context = {
    host: root,
    owner: '',
    repository: '',
    version: to,
    previousTag: from ?? '',
    currentTag: to,
    // A range with no lower bound has nothing to compare against, so the
    // heading is the ref itself rather than a link that would 404.
    linkCompare: from !== null,
    linkReferences: true,
  };

  const rendered = await collect(writer(context, preset.writerOpts), commits);
  // The writer links `#42` to this repository's own issues and nothing else,
  // which is a guess about where the team files its tickets. The ticket rules
  // are the answer to that, so they decide: what they recognised is linked from
  // what the extraction already attached to each entry, and what they did not
  // loses the link the writer gave it.
  //
  // Except the requests of the range. `#42` in a squashed subject is the pull
  // request the change landed in — the same object the entry carries a link to
  // — and dropping it would be answering a question nobody asked.
  const linked = linkTickets(
    rendered,
    entries.flatMap((entry) => entry.tickets),
    {
      prefix: `${root}/${paths.issue}/`,
      keep: new Map(
        entries.flatMap((entry) =>
          entry.pullRequest
            ? [[`#${entry.pullRequest.number}`, entry.pullRequest.url] as const]
            : [],
        ),
      ),
    },
  );
  // Linking can only reach a key the text already holds, and this generator
  // renders the commit message and nothing else — so a ticket the rules read
  // off a branch name or a request's description appears nowhere in it, and
  // would be lost by a page that found it.
  return mentionTickets(linked, entries);
}

/**
 * Names, on each rendered line, the tickets that line does not already name.
 *
 * The commit is what identifies the line: the writer hangs a link on every one
 * of them, and the sha inside that link is the only thing in its output that
 * ties a line back to the entry it was rendered from. Matching on the summary
 * would break the moment two commits share one.
 *
 * A line the entry already mentions is left alone, so this adds and never
 * repeats. Appended after the commit link rather than before the summary,
 * which is where the convention puts its own references — the layout belongs
 * to the package, and this is a guest in it.
 *
 * A commit the preset dropped has no line to be named on, and its tickets stay
 * unmentioned. That is the trade-off this generator already is, not a second
 * one: a commit following no convention is absent from these notes entirely.
 */
function mentionTickets(markdown: string, entries: ReleaseNoteEntry[]): string {
  const byCommit = new Map(entries.map((entry) => [entry.sha, entry.tickets]));

  return markdown
    .split('\n')
    .map((line) => {
      // Both platforms' commit paths end the same way, which is what makes one
      // expression enough: `…/commit/<sha>)` and `…/-/commit/<sha>)`.
      const sha = /\/commit\/([0-9a-f]+)\)/.exec(line)?.[1];
      const tickets = sha === undefined ? undefined : byCommit.get(sha);
      const missing = (tickets ?? []).filter((ticket) => !mentionsKey(line, ticket.key));
      if (missing.length === 0) return line;
      // A ticket that resolved to no URL is still named: the key is what a
      // reader searches their tracker for, and a link is the bonus.
      const refs = missing.map((t) => (t.url ? `[${t.key}](${t.url})` : t.key));
      return `${line}, ${refs.join(', ')}`;
    })
    .join('\n');
}

/** Drives the writer's stream to its end and returns what it wrote. */
function collect(stream: Transform, commits: unknown[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    stream.on('data', (chunk: Buffer | string) => chunks.push(String(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(chunks.join('').trim() + '\n'));
    for (const commit of commits) stream.write(commit);
    stream.end();
  });
}
