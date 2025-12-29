import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReleaseNoteEntry } from '@repo/shared';
import { RefLink } from './RefLink';

/**
 * Commits, as a release note or as a deployment's contents — the same reading
 * of the same entries, so the same list. Each line carries what a reader
 * verifies it with: the tickets it mentions, and the commit itself.
 */
export function CommitList({ entries }: { entries: ReleaseNoteEntry[] }) {
  return (
    <ul className="notes-list">
      {entries.map((entry) => (
        <CommitEntry key={entry.sha} entry={entry} />
      ))}
    </ul>
  );
}

/**
 * One commit: its summary always, the rest of its message on request.
 *
 * Folded by default, and folded one line at a time rather than by the list — a
 * range of a hundred commits is read by scanning summaries, and bodies opened
 * by default would bury the very thing being scanned. The one worth opening
 * gets opened; the rest stay one line each.
 */
function CommitEntry({ entry }: { entry: ReleaseNoteEntry }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const body = commitBody(entry.message);

  return (
    <li>
      {entry.scope && <b>{entry.scope}: </b>}
      {/* The whole message on hover, for whoever only wants a look: it costs
          nothing and answers most of what unfolding would. */}
      <span title={entry.message}>{entry.summary}</span>{' '}
      {body && (
        <button
          type="button"
          className="commit-toggle"
          aria-expanded={open}
          // The arrow is the whole of the button's text, so it would be the
          // whole of its name to a screen reader without this.
          aria-label={t(open ? 'common.collapseCommit' : 'common.expandCommit')}
          title={t(open ? 'common.collapseCommit' : 'common.expandCommit')}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'}
        </button>
      )}{' '}
      {entry.tickets.map((ticket) => (
        <TicketRef key={ticket.key} label={ticket.key} url={ticket.url ?? null} />
      ))}{' '}
      {/* The request before the commit: what the change was discussed as comes
          before what it did, and it is the link most readers actually follow. */}
      {entry.pullRequest && (
        <>
          <RefLink name={`#${entry.pullRequest.number}`} url={entry.pullRequest.url} />{' '}
        </>
      )}
      <RefLink name={entry.sha.slice(0, 7)} url={entry.url} />
      {/* Rendered only while open, so a folded list holds no hidden text for a
          search of the page to land on. */}
      {open && body && <pre className="commit-body">{body}</pre>}
    </li>
  );
}

/**
 * What a commit says past its first line, without the blank line that separates
 * the two. Empty for the many commits that are a subject and nothing else —
 * which is also what decides whether there is anything to unfold.
 */
function commitBody(message: string): string {
  const cut = message.indexOf('\n');
  return cut === -1 ? '' : message.slice(cut + 1).trim();
}

/** A ticket, linked when its tracker's template resolved to something. */
function TicketRef({ label, url }: { label: string; url: string | null }) {
  if (!url) return <span className="pill attr">{label}</span>;
  return (
    <a className="pill attr" href={url} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}
