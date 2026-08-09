import { useCallback, useMemo, useState } from 'react';
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
import { releaseNotesCodec, useUrlQuery } from '../urlQuery';
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
  const [tags, setTags] = useState<Tag[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  /**
   * The range lives in the address, so a back walks it and a link carries it —
   * "the notes between these two tags" is exactly the kind of thing that gets
   * pasted into a chat.
   */
  const { query, setQuery, replaceQuery } = useUrlQuery(releaseNotesCodec);
  const { repo, from, to, tagPattern } = query;
  const setRange = (patch: Partial<typeof query>) => setQuery((q) => ({ ...q, ...patch }));

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
      // the same rule the source picker follows. Amended into the address
      // rather than added to it: a default the page picked is not a step
      // anybody meant to take.
      replaceQuery((current) =>
        inScope.includes(current.repo) ? current : { ...current, repo: inScope[0] ?? '' },
      );
    },
    [sourceId, canRewrite, replaceQuery],
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
        // Every tag of the repo, unnarrowed. The component pattern is applied
        // to this list below rather than sent here: it is typed a character at
        // a time, and this call reaches the platform.
        api.tags(sourceId, repo, undefined, signal),
        api.branches(sourceId, repo, signal),
      ]);
      setTags(repoTags);
      setBranches(repoBranches);
      // The bounds belong to the repo that was showing: keeping them would ask
      // for a range made of another repo's refs.
      setNotes(null);
      setRewritten(null);
    },
    [sourceId, repo],
  );
  const refsLoad = useCancellableLoad(loadRefs);

  /**
   * The tags the bound pickers offer: the repo's own, narrowed to the component
   * being summarised. Computed here rather than asked of the server — the same
   * filter the generation applies, over a list already in hand, so a pattern
   * being typed costs nothing.
   *
   * A pattern the engine cannot read narrows nothing, which is what the backend
   * does too: half of `^front@(` is a state every regex passes through while it
   * is being typed, and emptying the pickers at each of them would be noise.
   */
  const visibleTags = useMemo(() => {
    if (!tagPattern) return tags;
    let regex: RegExp;
    try {
      regex = new RegExp(tagPattern);
    } catch {
      return tags;
    }
    return tags.filter((tag) => regex.test(tag.name));
  }, [tags, tagPattern]);

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
          tagPattern: tagPattern || undefined,
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

        {/* One bar, left to right in the order the controls decide things: the
            repo, the component narrowing its tags, then the two bounds picked
            from what is left. The three short fields are narrowed rather than
            given a filter's usual width — a repository path is a sentence, a
            tag is `front@1.3.0` — which is what keeps five controls on one
            line instead of wrapping the bounds onto their own. */}
        {repos.length > 0 && (
          <div className="filters-row">
            <FilterField label={t('releaseNotes.repo')}>
              <select
                value={repo}
                onChange={(e) =>
                  setQuery({ repo: e.target.value, from: '', to: '', tagPattern: '' })
                }
              >
                {repos.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </FilterField>
            {/* Beside the repo rather than beside the bounds: the two of them
                say *what* is being summarised, and this one decides what the
                bounds after it are even picked from. */}
            <FilterField label={t('releaseNotes.component')} narrow>
              <input
                className="mono-input"
                value={tagPattern}
                /* The bounds belong to the component that was showing, exactly
                   as they belong to the repo. */
                onChange={(e) => setQuery({ ...query, tagPattern: e.target.value, from: '', to: '' })}
                placeholder={t('releaseNotes.componentPlaceholder')}
                spellCheck={false}
              />
            </FilterField>
            <FilterField label={t('releaseNotes.from')} narrow>
              <RefSelect
                value={from}
                onChange={(value) => setRange({ from: value })}
                /* Empty is not "no bound": it is the tag below `to`, which is
                   what a release note almost always wants. */
                autoLabel={t('releaseNotes.fromAuto')}
                tags={visibleTags}
                branches={branches}
                disabled={refsLoad.loading}
              />
            </FilterField>
            <FilterField label={t('releaseNotes.to')} narrow>
              <RefSelect
                value={to}
                onChange={(value) => setRange({ to: value })}
                autoLabel={t('releaseNotes.toAuto')}
                tags={visibleTags}
                branches={branches}
                disabled={refsLoad.loading}
              />
            </FilterField>
            <button className="btn primary" disabled={!repo || busy} onClick={() => void generate()}>
              {busy && !rewritten ? t('releaseNotes.generating') : t('releaseNotes.generate')}
            </button>
          </div>
        )}
        {visibleTags.length === 0 && repo && !refsLoad.loading && (
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
            {/* Left alone, the notes come out in the language the commits were
                written in — not the reader's, and not the model's. Naming one
                here is asking for a translation, which is a different thing. */}
            <FilterField
              label={t('releaseNotes.language')}
              hint={language ? undefined : t('releaseNotes.languageKeepHint')}
            >
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
