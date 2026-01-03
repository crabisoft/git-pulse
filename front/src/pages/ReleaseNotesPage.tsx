import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PAGE_LIMIT_MAX,
  type Branch,
  type LlmProviderPublic,
  type ReleaseNotes,
  type RewriteResult,
  type Tag,
} from '@repo/shared';
import { api, apiErrorInfo, isAbort } from '../api';
import { useCancellableLoad } from '../hooks';
import { useAuth } from '../auth';
import { RefSelect } from '../RefSelect';
import { RefLink } from '../RefLink';
import { CommitList } from '../CommitList';
import { FilterField } from '../Filters';
import { CopyButton } from '../CopyButton';

/** Languages the rewriting offers, as tags — the UI's own, named in the UI's locale. */
const LANGUAGES = ['en', 'fr'];

export function ReleaseNotesPage({ sourceId }: { sourceId: string }) {
  const { t, i18n } = useTranslation();
  const { state } = useAuth();
  // Rewriting spends the install's model budget, so it asks for an account —
  // a visitor reading a public dashboard gets the notes and not the button.
  //
  // An install that declared no provider is treated the same way: the whole
  // panel is absent rather than present and explaining itself. A control that
  // cannot act is noise on every visit, and the place to fix it is Settings,
  // which is where an admin already is when they care.
  const canRewrite = Boolean(state?.user);

  const [repos, setRepos] = useState<string[]>([]);
  const [repo, setRepo] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [notes, setNotes] = useState<ReleaseNotes | null>(null);
  const [rewritten, setRewritten] = useState<RewriteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [providers, setProviders] = useState<LlmProviderPublic[]>([]);
  const [providerId, setProviderId] = useState('');
  const [language, setLanguage] = useState('');

  /**
   * The vocabularies: the repos in scope, and the providers that may rewrite.
   * Both are cheap and neither depends on the range, so they load once.
   */
  const loadScope = useCallback(
    async (signal: AbortSignal) => {
      const [inScope, available] = await Promise.all([
        api.sourceRepos(sourceId, signal),
        canRewrite
          ? api.listLlmProviders({ limit: PAGE_LIMIT_MAX }).then((page) => page.items)
          : Promise.resolve([]),
      ]);
      setRepos(inScope);
      setProviders(available);
      setProviderId(available.find((p) => p.isDefault)?.id ?? available[0]?.id ?? '');
      // Nothing is selected until the list is known, so the first repo wins —
      // the same rule the source picker follows.
      setRepo((current) => (inScope.includes(current) ? current : (inScope[0] ?? '')));
    },
    [sourceId, canRewrite],
  );
  const scope = useCancellableLoad(loadScope);

  /**
   * The refs the selected repo offers, so a bound can be picked rather than
   * typed. Tags and branches are fetched together because the control offers
   * both, and kept apart because they are not the same thing.
   */
  const loadRefs = useCallback(
    async (signal: AbortSignal) => {
      if (!repo) {
        setTags([]);
        setBranches([]);
        return;
      }
      const [repoTags, repoBranches] = await Promise.all([
        api.tags(sourceId, repo, signal),
        api.branches(sourceId, repo, signal),
      ]);
      setTags(repoTags);
      setBranches(repoBranches);
      // The bounds belong to the repo that was showing: keeping them would ask
      // for a range made of another repo's refs.
      setFrom('');
      setTo('');
      setNotes(null);
      setRewritten(null);
    },
    [sourceId, repo],
  );
  const refsLoad = useCancellableLoad(loadRefs);

  /**
   * Generating walks a history and is as expensive as a DORA report, so it runs
   * on a click rather than on every change of the range.
   */
  async function generate() {
    setBusy(true);
    setError(null);
    setRewritten(null);
    try {
      setNotes(
        await api.releaseNotes(sourceId, {
          repo,
          from: from || undefined,
          to: to || undefined,
        }),
      );
    } catch (e) {
      if (!isAbort(e)) {
        const { code, params } = apiErrorInfo(e);
        setError(t(code, params));
      }
    } finally {
      setBusy(false);
    }
  }

  async function rewrite() {
    if (!notes) return;
    setBusy(true);
    setError(null);
    try {
      setRewritten(
        await api.rewriteReleaseNotes({
          markdown: notes.markdown,
          providerId: providerId || undefined,
          language: language || undefined,
        }),
      );
    } catch (e) {
      if (!isAbort(e)) {
        const { code, params } = apiErrorInfo(e);
        setError(t(code, params));
      }
    } finally {
      setBusy(false);
    }
  }

  const languageName = new Intl.DisplayNames([i18n.resolvedLanguage ?? 'en'], {
    type: 'language',
  });

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('releaseNotes.rangeTitle')}</h2>
        </div>
        <p className="muted subtabs-hint">{t('releaseNotes.hint')}</p>

        {scope.error && <div className="banner error">{scope.error}</div>}
        {refsLoad.error && <div className="banner error">{refsLoad.error}</div>}
        {error && <div className="banner error">{error}</div>}

        {!scope.loading && repos.length === 0 && (
          <p className="muted">{t('releaseNotes.noRepo')}</p>
        )}

        {repos.length > 0 && (
          <div className="filters-row">
            <FilterField label={t('releaseNotes.repo')}>
              <select value={repo} onChange={(e) => setRepo(e.target.value)}>
                {repos.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label={t('releaseNotes.from')}>
              <RefSelect
                value={from}
                onChange={setFrom}
                /* Empty is not "no bound": it is the tag below `to`, which is
                   what a release note almost always wants. */
                autoLabel={t('releaseNotes.fromAuto')}
                tags={tags}
                branches={branches}
                disabled={refsLoad.loading}
              />
            </FilterField>
            <FilterField label={t('releaseNotes.to')}>
              <RefSelect
                value={to}
                onChange={setTo}
                autoLabel={t('releaseNotes.toAuto')}
                tags={tags}
                branches={branches}
                disabled={refsLoad.loading}
              />
            </FilterField>
            <button className="btn primary" disabled={!repo || busy} onClick={() => void generate()}>
              {busy && !rewritten ? t('releaseNotes.generating') : t('releaseNotes.generate')}
            </button>
          </div>
        )}
        {tags.length === 0 && repo && !refsLoad.loading && (
          <p className="muted">{t('releaseNotes.noTag')}</p>
        )}
      </section>

      {notes && (
        <section className="panel">
          <div className="panel-head">
            <h2>
              {notes.repo} —{' '}
              {notes.from && (
                <>
                  <RefLink name={notes.from} url={notes.fromUrl} />…
                </>
              )}
              <RefLink name={notes.to} url={notes.toUrl} />
            </h2>
            <CopyButton text={notes.markdown} />
          </div>

          {notes.breaking.length > 0 && (
            <>
              <h3>{t('releaseNotes.breaking')}</h3>
              <CommitList entries={notes.breaking} />
            </>
          )}
          {notes.sections.length === 0 && <p className="muted">{t('releaseNotes.empty')}</p>}
          {notes.sections.map((section) => (
            <div key={section.type}>
              {/* Named when the convention names it — a heading reading `chore`
                  is a type, not a title. An unknown one keeps its type, which
                  is the only honest thing to call it. */}
              <h3>{t(`releaseNotes.section.${section.type}`, section.type)}</h3>
              <CommitList entries={section.entries} />
            </div>
          ))}

          <details className="markdown-source">
            <summary>
              {t('releaseNotes.markdown')}
              {' · '}
              {t(`releaseNotes.generator.${notes.generator}`)}
            </summary>
            {/* The sections above list every commit; this generator lists the
                ones it can parse. Saying so beats leaving the reader to notice. */}
            {notes.generator === 'conventional-changelog' && (
              <p className="muted subtabs-hint">{t('releaseNotes.generatorHint')}</p>
            )}
            <pre className="mono">{notes.markdown}</pre>
          </details>
        </section>
      )}

      {notes && canRewrite && providers.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>{t('releaseNotes.rewriteTitle')}</h2>
          </div>
          <p className="muted subtabs-hint">{t('releaseNotes.rewriteHint')}</p>

          <div className="filters-row">
            <FilterField label={t('releaseNotes.provider')}>
              <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name} ({provider.model})
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label={t('releaseNotes.language')}>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="">{t('releaseNotes.languageKeep')}</option>
                {LANGUAGES.map((tag) => (
                  <option key={tag} value={tag}>
                    {languageName.of(tag) ?? tag}
                  </option>
                ))}
              </select>
            </FilterField>
            <button className="btn primary" disabled={busy} onClick={() => void rewrite()}>
              {busy ? t('releaseNotes.rewriting') : t('releaseNotes.rewrite')}
            </button>
          </div>

          {rewritten && (
            <>
              {/* The generated notes stay above on purpose: the only way to
                  catch a model that embellished is to read the two together. */}
              <div className="panel-head">
                <h3>
                  {t('releaseNotes.rewrittenBy', {
                    name: rewritten.providerName,
                    model: rewritten.model,
                  })}
                </h3>
                <CopyButton text={rewritten.markdown} />
              </div>
              <pre className="mono">{rewritten.markdown}</pre>
            </>
          )}
        </section>
      )}
    </>
  );
}
