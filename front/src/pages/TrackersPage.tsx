import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PAGE_LIMIT_MAX,
  TRACKER_URL_TEMPLATES,
  type SourcePublic,
  type TrackerKind,
  type TrackerPublic,
} from '@repo/shared';
import { api, apiErrorInfo, type CreateTrackerInput } from '../api';
import { DeleteIcon, EditIcon, PlusIcon } from '../icons';
import { IconButton } from '../IconButton';
import { ConfirmDialog, Modal } from '../Modal';

const KINDS: TrackerKind[] = ['jira', 'linear', 'github', 'gitlab'];

const EMPTY: CreateTrackerInput = { name: '', kind: 'jira', baseUrl: '', urlTemplate: '' };

export function TrackersPage({ sources }: { sources: SourcePublic[] }) {
  const { t } = useTranslation();
  const [trackers, setTrackers] = useState<TrackerPublic[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [editing, setEditing] = useState<{ tracker: TrackerPublic | null } | null>(null);
  const [deleting, setDeleting] = useState<TrackerPublic | null>(null);

  const load = useCallback(async () => {
    try {
      // Few by nature, and the rule form needs them all: ask for the cap.
      const { items } = await api.listTrackers({ limit: PAGE_LIMIT_MAX });
      setTrackers(items);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(tracker: TrackerPublic) {
    setDeleting(null);
    try {
      await api.deleteTracker(tracker.id);
      setMsg({ kind: 'ok', text: t('trackers.deleted') });
      await load();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  const sourceName = (id: string) => sources.find((s) => s.id === id)?.name ?? id;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('trackers.listTitle')}</h2>
          <button className="btn primary" onClick={() => setEditing({ tracker: null })}>
            <PlusIcon /> {t('trackers.addTitle')}
          </button>
        </div>
        <p className="muted subtabs-hint">{t('trackers.hint')}</p>

        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
        {trackers.length === 0 && <p className="muted">{t('trackers.listEmpty')}</p>}

        {trackers.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th>{t('trackers.form.name')}</th>
                <th>{t('trackers.form.kind')}</th>
                <th>{t('trackers.form.baseUrl')}</th>
                <th>{t('trackers.form.sources')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {trackers.map((tracker) => (
                <tr key={tracker.id}>
                  <td>{tracker.name}</td>
                  <td>
                    <span className="pill attr">{tracker.kind}</span>
                  </td>
                  <td className="mono">{tracker.baseUrl}</td>
                  <td>
                    {/* Read-only: attaching happens from the source. */}
                    {tracker.sources.length === 0 ? (
                      <span className="muted">{t('trackers.noSource')}</span>
                    ) : (
                      <div className="pills">
                        {tracker.sources.map((b) => (
                          <span key={b.sourceId} className="pill attr">
                            {sourceName(b.sourceId)}
                            {b.incidents && <b> · {t('trackers.incidentsBadge')}</b>}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <IconButton
                        label={t('common.edit')}
                        onClick={() => setEditing({ tracker })}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        label={t('common.delete')}
                        tone="danger"
                        onClick={() => setDeleting(tracker)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editing && (
        <TrackerDialog
          tracker={editing.tracker}
          onClose={() => setEditing(null)}
          onSaved={async (created) => {
            setEditing(null);
            setMsg({ kind: 'ok', text: t(created ? 'trackers.added' : 'trackers.updated') });
            await load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('trackers.deleteTitle')}
          message={t('trackers.confirmDelete', { name: deleting.name })}
          confirmLabel={t('common.delete')}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/** Create/edit form, in a modal. `tracker` null means creation. */
function TrackerDialog({
  tracker,
  onClose,
  onSaved,
}: {
  tracker: TrackerPublic | null;
  onClose: () => void;
  onSaved: (created: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateTrackerInput>(
    tracker
      ? {
          name: tracker.name,
          kind: tracker.kind,
          baseUrl: tracker.baseUrl,
          urlTemplate: tracker.urlTemplate ?? '',
        }
      : EMPTY,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CreateTrackerInput>(k: K, v: CreateTrackerInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));


  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // An empty template means "derive it from the kind", which the API spells null.
    const input = { ...form, urlTemplate: form.urlTemplate ? form.urlTemplate : null };
    try {
      if (tracker) await api.updateTracker(tracker.id, input);
      else await api.createTracker(input);
      await onSaved(!tracker);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setBusy(false);
    }
  }

  const title = tracker ? t('trackers.editTitle', { name: tracker.name }) : t('trackers.addTitle');

  return (
    <Modal
      title={title}
      label={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={busy} type="submit" form="tracker-form">
            {busy ? t('common.saving') : tracker ? t('common.save') : t('trackers.form.submit')}
          </button>
        </>
      }
    >
      <form id="tracker-form" onSubmit={submit} className="form">
        <label>
          {t('trackers.form.name')}
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
        </label>
        <label>
          {t('trackers.form.kind')}
          <select value={form.kind} onChange={(e) => set('kind', e.target.value as TrackerKind)}>
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('trackers.form.baseUrl')}
          <input
            className="mono-input"
            value={form.baseUrl}
            onChange={(e) => set('baseUrl', e.target.value)}
            placeholder="https://acme.atlassian.net"
            spellCheck={false}
            required
          />
        </label>
        <label>
          {t('trackers.form.urlTemplate')}{' '}
          <span className="hint">{t('trackers.form.urlTemplateHint')}</span>
          <input
            className="mono-input"
            value={form.urlTemplate ?? ''}
            onChange={(e) => set('urlTemplate', e.target.value)}
            // Shows what leaving it empty will do, rather than an invented example.
            placeholder={TRACKER_URL_TEMPLATES[form.kind]}
            spellCheck={false}
          />
        </label>

        {error && <div className="banner error">{error}</div>}
      </form>
    </Modal>
  );
}
