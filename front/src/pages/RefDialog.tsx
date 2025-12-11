import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Branch, Tag } from '@repo/shared';
import { api } from '../api';
import { useCancellableLoad } from '../hooks';
import { Modal } from '../Modal';
import { RefSelect } from '../RefSelect';

/**
 * Picks the ref a comparison starts from: a tag, a branch, or a commit typed by
 * hand. Applied in one go, like the custom period — the comparison behind it is
 * a round of platform calls, and refetching on every keystroke of a sha would
 * spend a budget to answer questions nobody asked.
 *
 * The picker and the field are one control, not two: a sha is a ref like the
 * others, and whichever is touched last wins.
 */
export function RefDialog({
  sourceId,
  repo,
  value,
  onApply,
  onClose,
}: {
  sourceId: string;
  repo: string;
  /** The ref currently compared against, so the dialog opens where it left off. */
  value: string;
  onApply: (ref: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [tags, setTags] = useState<Tag[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const [repoTags, repoBranches] = await Promise.all([
        api.tags(sourceId, repo, signal),
        api.branches(sourceId, repo, signal),
      ]);
      setTags(repoTags);
      setBranches(repoBranches);
    },
    [sourceId, repo],
  );
  const { loading, error } = useCancellableLoad(load);

  /** A ref picked from the list is a ref typed in the field — same value. */
  const known = tags.some((tag) => tag.name === draft) || branches.some((b) => b.name === draft);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (draft.trim()) onApply(draft.trim());
  }

  return (
    <Modal
      title={t('deployments.refTitle')}
      label={t('deployments.refTitle')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" type="submit" form="ref-form" disabled={!draft.trim()}>
            {t('deployments.refApply')}
          </button>
        </>
      }
    >
      <form id="ref-form" onSubmit={submit} className="form">
        <label>
          {t('deployments.refPick')}
          <RefSelect
            // Shows nothing selected while the field holds a sha: the sha is
            // the answer, and pretending a tag is chosen would be a lie.
            value={known ? draft : ''}
            onChange={setDraft}
            autoLabel={t('deployments.refNone')}
            tags={tags}
            branches={branches}
            disabled={loading}
          />
        </label>
        <label>
          {t('deployments.refType')} <span className="hint">{t('deployments.refTypeHint')}</span>
          <input
            className="mono-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="3f2a91c"
            spellCheck={false}
            autoFocus
          />
        </label>

        {error && <div className="banner error">{error}</div>}
        {loading && <p className="muted">{t('common.loading')}</p>}
      </form>
    </Modal>
  );
}
