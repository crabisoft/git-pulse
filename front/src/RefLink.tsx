/**
 * A branch, a tag or a commit, opened on the platform that hosts it.
 *
 * The URL is built on the backend and travels with the payload: which platform
 * a source is on decides the shape of that link, and nothing in this UI names
 * one. A new tab because the reader is comparing, not leaving — losing the
 * filters they set to go look at a ref would be the wrong trade.
 */
export function RefLink({ name, url }: { name: string; url: string | null }) {
  if (!url) return <span className="mono">{name}</span>;
  return (
    <a className="mono" href={url} target="_blank" rel="noreferrer">
      {name}
    </a>
  );
}
