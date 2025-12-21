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
        <li key={entry.sha}>
          {entry.scope && <b>{entry.scope}: </b>}
          {entry.summary}{' '}
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
        </li>
      ))}
    </ul>
  );
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
