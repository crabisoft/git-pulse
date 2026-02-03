import type { Transform } from 'node:stream';
import writer from 'conventional-changelog-writer';
import { sync as parseCommit } from 'conventional-commits-parser';
import createPreset from 'conventional-changelog-conventionalcommits';
import type { ReleaseNoteEntry } from '@repo/shared';
import { repoUrl, type RepoLocation } from '../sources/connectors/ref-url';
import { linkTickets } from './link-tickets';

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
  // The writer links `#42` to this repository's own issues and nothing else.
  // Everything a ticket rule recognised — a Jira key, a Linear one — is linked
  // here, from what the extraction already attached to each entry.
  return linkTickets(
    rendered,
    entries.flatMap((entry) => entry.tickets),
  );
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
