import { useTranslation } from 'react-i18next';
import type { DeploymentBase } from '@repo/shared';

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

/**
 * The ref a comparison was made against, and what made it that one.
 *
 * "Against develop" is a complete sentence and still not an answer: develop
 * could be the last thing deployed here, the branch this one was cut from, or
 * the repo's own default — three different readings of the same line, and the
 * reader has no way to tell which. The record has always known; it is said
 * here.
 *
 * A ref the reader named is the exception: they named it, so naming it back at
 * them explains nothing.
 */
export function BaseRef({
  base,
  name,
  url,
}: {
  base: DeploymentBase;
  name: string;
  url: string | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      {base === 'ref' ? t('deployments.against') : t(`deployments.againstKind.${base}`)}{' '}
      <RefLink name={name} url={url} />
    </>
  );
}
