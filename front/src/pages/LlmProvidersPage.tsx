import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LLM_BASE_URLS,
  LLM_DEFAULT_MODELS,
  LLM_KINDS,
  PAGE_LIMIT_MAX,
  type LlmKind,
  type LlmProviderPublic,
} from '@repo/shared';
import { api, apiErrorInfo, type CreateLlmProviderInput } from '../api';
import { DeleteIcon, EditIcon, PlusIcon } from '../icons';
import { IconButton } from '../IconButton';
import { ConfirmDialog, Modal } from '../Modal';

const EMPTY: CreateLlmProviderInput = {
  name: '',
  kind: 'anthropic',
  model: LLM_DEFAULT_MODELS.anthropic ?? '',
  apiKey: '',
  baseUrl: '',
};

export function LlmProvidersPage() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<LlmProviderPublic[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [editing, setEditing] = useState<{ provider: LlmProviderPublic | null } | null>(null);
  const [deleting, setDeleting] = useState<LlmProviderPublic | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // A handful at most, and the release-notes picker needs them all.
      const { items } = await api.listLlmProviders({ limit: PAGE_LIMIT_MAX });
      setProviders(items);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(provider: LlmProviderPublic) {
    setDeleting(null);
    try {
      await api.deleteLlmProvider(provider.id);
      setMsg({ kind: 'ok', text: t('llm.deleted') });
      await load();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  async function test(provider: LlmProviderPublic) {
    setTesting(provider.id);
    setMsg(null);
    try {
      const result = await api.testLlmProvider(provider.id);
      setMsg({
        kind: result.ok ? 'ok' : 'err',
        text: t(result.message.code, result.message.params),
      });
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    } finally {
      setTesting(null);
    }
  }

  /** Moving the default is a one-field update, so it needs no form. */
  async function makeDefault(provider: LlmProviderPublic) {
    try {
      await api.updateLlmProvider(provider.id, { isDefault: true });
      await load();
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setMsg({ kind: 'err', text: t(code, params) });
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('llm.listTitle')}</h2>
          <button className="btn primary" onClick={() => setEditing({ provider: null })}>
            <PlusIcon /> {t('llm.addTitle')}
          </button>
        </div>
        <p className="muted subtabs-hint">{t('llm.hint')}</p>

        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
        {providers.length === 0 && <p className="muted">{t('llm.listEmpty')}</p>}

        {providers.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th>{t('llm.form.name')}</th>
                <th>{t('llm.form.kind')}</th>
                <th>{t('llm.form.model')}</th>
                <th>{t('llm.form.baseUrl')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td>
                    {provider.name}{' '}
                    {provider.isDefault && (
                      <span className="pill meta">{t('llm.defaultBadge')}</span>
                    )}
                    {/* A provider without a key cannot answer, and would only say so at the first call. */}
                    {!provider.hasKey && (
                      <span className="pill status-failed">{t('llm.noKeyBadge')}</span>
                    )}
                  </td>
                  <td>
                    <span className="pill attr">{provider.kind}</span>
                  </td>
                  <td className="mono">{provider.model}</td>
                  <td className="mono">
                    {provider.baseUrl ?? (
                      <span className="muted">{t('llm.defaultEndpoint')}</span>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      {!provider.isDefault && (
                        <button className="btn" onClick={() => void makeDefault(provider)}>
                          {t('llm.makeDefault')}
                        </button>
                      )}
                      <button
                        className="btn"
                        disabled={testing === provider.id}
                        onClick={() => void test(provider)}
                      >
                        {testing === provider.id ? t('llm.testing') : t('llm.runTest')}
                      </button>
                      <IconButton label={t('common.edit')} onClick={() => setEditing({ provider })}>
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        label={t('common.delete')}
                        tone="danger"
                        onClick={() => setDeleting(provider)}
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
        <ProviderDialog
          provider={editing.provider}
          onClose={() => setEditing(null)}
          onSaved={async (created) => {
            setEditing(null);
            setMsg({ kind: 'ok', text: t(created ? 'llm.added' : 'llm.updated') });
            await load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('llm.deleteTitle')}
          message={t('llm.confirmDelete', { name: deleting.name })}
          confirmLabel={t('common.delete')}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/** Create/edit form, in a modal. `provider` null means creation. */
function ProviderDialog({
  provider,
  onClose,
  onSaved,
}: {
  provider: LlmProviderPublic | null;
  onClose: () => void;
  onSaved: (created: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateLlmProviderInput>(
    provider
      ? {
          name: provider.name,
          kind: provider.kind,
          model: provider.model,
          // Never prefilled: the key is not readable, so an empty field here
          // means "keep the stored one" rather than "erase it".
          apiKey: '',
          baseUrl: provider.baseUrl ?? '',
        }
      : EMPTY,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CreateLlmProviderInput>(k: K, v: CreateLlmProviderInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  /**
   * Changing the vendor changes what a model name even looks like. The known
   * default replaces the field; where we state none, it is cleared rather than
   * left pointing at another vendor's model.
   */
  const changeKind = (kind: LlmKind) =>
    setForm((f) => ({ ...f, kind, model: LLM_DEFAULT_MODELS[kind] ?? '' }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input = {
      ...form,
      baseUrl: form.baseUrl ? form.baseUrl : null,
    };
    try {
      if (provider) {
        // Omitted rather than sent empty: empty would fail validation, and the
        // intent of an untouched field is to keep what is stored.
        const { apiKey, ...rest } = input;
        await api.updateLlmProvider(provider.id, apiKey ? input : rest);
      } else {
        await api.createLlmProvider(input);
      }
      await onSaved(!provider);
    } catch (err) {
      const { code, params } = apiErrorInfo(err);
      setError(t(code, params));
      setBusy(false);
    }
  }

  const title = provider ? t('llm.editTitle', { name: provider.name }) : t('llm.addTitle');

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
          <button className="btn primary" disabled={busy} type="submit" form="llm-form">
            {busy ? t('common.saving') : provider ? t('common.save') : t('llm.form.submit')}
          </button>
        </>
      }
    >
      <form id="llm-form" onSubmit={submit} className="form">
        <label>
          {t('llm.form.name')}
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          {t('llm.form.kind')}
          <select value={form.kind} onChange={(e) => changeKind(e.target.value as LlmKind)}>
            {LLM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('llm.form.model')} <span className="hint">{t('llm.form.modelHint')}</span>
          <input
            className="mono-input"
            value={form.model}
            onChange={(e) => set('model', e.target.value)}
            spellCheck={false}
            required
          />
        </label>
        <label>
          {t('llm.form.apiKey')}{' '}
          {provider && <span className="hint">{t('llm.form.apiKeyKeep')}</span>}
          <input
            className="mono-input"
            type="password"
            value={form.apiKey}
            onChange={(e) => set('apiKey', e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required={!provider}
          />
        </label>
        <label>
          {t('llm.form.baseUrl')} <span className="hint">{t('llm.form.baseUrlHint')}</span>
          <input
            className="mono-input"
            value={form.baseUrl ?? ''}
            onChange={(e) => set('baseUrl', e.target.value)}
            // Shows what leaving it empty will do, rather than an invented example.
            placeholder={LLM_BASE_URLS[form.kind]}
            spellCheck={false}
          />
        </label>
        {/* Absent while editing: moving the default is a row action, and a
            checkbox that refuses to be unticked would only puzzle. */}
        {!provider && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.isDefault ?? false}
              onChange={(e) => set('isDefault', e.target.checked)}
            />
            {t('llm.form.isDefault')}
          </label>
        )}

        {error && <div className="banner error">{error}</div>}
      </form>
    </Modal>
  );
}
