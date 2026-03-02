import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DataList } from '../DataList';
import type { DashboardLive, PipelineStatus, TicketRef } from '@repo/shared';
import { api, type PageQuery } from '../api';
import { useCancellableLoad } from '../hooks';
import { Pagination } from '../Pagination';
import { sinceLabel } from './parts';

/**
 * The exhaustive lists, under the summary that replaced them.
 *
 * Folded shut and not fetched until opened: they are a full round of connector
 * calls, and the reason this page exists is that most visits are answered by
 * the summary alone. Opening one is the reader saying otherwise.
 */
export function DetailPanels({
  sourceId,
  repos,
  staleHours,
}: {
  sourceId: string;
  repos: string[];
  staleHours: number | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="detail-panels">
      <Panel label={t('overview.details.prs')}>
        <DetailBody sourceId={sourceId} repos={repos} kind="prs" staleHours={staleHours} />
      </Panel>
      <Panel label={t('overview.details.pipelines')}>
        <DetailBody sourceId={sourceId} repos={repos} kind="pipelines" staleHours={staleHours} />
      </Panel>
    </div>
  );
}

/**
 * A panel whose contents are not in the tree until it is opened.
 *
 * `details` hides what it is closed on, but React mounts it all the same — and
 * a mounted body here means a full round of connector calls on a page nobody
 * asked it of. The open state has to be ours for the fetch to be lazy.
 *
 * It stays mounted afterwards: having opened it once, closing it should not
 * make re-opening cost another round trip.
 */
function Panel({ label, children }: { label: string; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <details onToggle={(e) => e.currentTarget.open && setOpened(true)}>
      <summary>{label}</summary>
      {opened && children}
    </details>
  );
}
function DetailBody({
  sourceId,
  repos,
  kind,
  staleHours,
}: {
  sourceId: string;
  repos: string[];
  kind: 'prs' | 'pipelines';
  staleHours: number | null;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardLive | null>(null);
  const [page, setPage] = useState<PageQuery>({});

  const load = useCallback(
    async (signal: AbortSignal) =>
      setData(
        await api.live(
          sourceId,
          {
            repos,
            // Only the list being read is paged through; the other one comes
            // back at its smallest, since nothing here renders it.
            prs: kind === 'prs' ? page : { limit: 1 },
            pipelines: kind === 'pipelines' ? page : { limit: 1 },
            environments: { limit: 1 },
          },
          signal,
        ),
      ),
    [sourceId, repos, kind, page],
  );
  const { loading, error } = useCancellableLoad(load);

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <p className="muted empty-note">{t('common.refreshing')}</p>;

  const stale = staleHours ?? 72;
  const list = kind === 'prs' ? data.pullRequests : data.pipelines;

  if (list.items.length === 0) {
    return <p className="muted empty-note">{t(`overview.details.${kind}Empty`)}</p>;
  }

  return (
    <>
      {/* Two sets of columns rather than two tables: what a panel lists changes,
          how it is rendered at each width does not — see DataList. */}
      {kind === 'prs' ? (
        <DataList
          rows={data.pullRequests.items}
          rowKey={(pr) => pr.id}
          rowClass={(pr) => (pr.ageHours >= stale ? 'stale' : undefined)}
          columns={[
            {
              key: 'repo',
              header: t('dashboard.cols.repo'),
              className: 'mono',
              cell: (pr) => (
                <a href={pr.repoUrl} target="_blank" rel="noreferrer">
                  {pr.repo}
                </a>
              ),
            },
            {
              key: 'title',
              header: t('dashboard.cols.title'),
              role: 'lead',
              cell: (pr) => (
                <>
                  <a href={pr.url} target="_blank" rel="noreferrer">
                    #{pr.number} {pr.title}
                  </a>
                  {pr.tickets.length > 0 && (
                    <div className="pills ticket-refs">
                      {pr.tickets.map((ref) => (
                        <TicketPill key={`${ref.tracker.name}:${ref.key}`} ticket={ref} />
                      ))}
                    </div>
                  )}
                </>
              ),
            },
            { key: 'author', header: t('dashboard.cols.author'), cell: (pr) => pr.author },
            {
              key: 'age',
              header: t('dashboard.cols.age'),
              className: 'num',
              // The same reading as the control room gives an environment: a
              // bare hour count made a four-day-old PR and a four-hour-old one
              // look like neighbours, and said nothing at all under one hour.
              cell: (pr) => sinceLabel(pr.createdAt),
            },
          ]}
        />
      ) : (
        <DataList
          rows={data.pipelines.items}
          rowKey={(pipeline) => pipeline.id}
          columns={[
            {
              key: 'repo',
              header: t('dashboard.cols.repo'),
              className: 'mono',
              cell: (pipeline) => (
                <a href={pipeline.repoUrl} target="_blank" rel="noreferrer">
                  {pipeline.repo}
                </a>
              ),
            },
            {
              key: 'ref',
              header: t('dashboard.cols.ref'),
              role: 'lead',
              className: 'mono',
              cell: (pipeline) => (
                <a href={pipeline.url} target="_blank" rel="noreferrer">
                  {pipeline.ref}
                </a>
              ),
            },
            {
              key: 'status',
              header: t('dashboard.cols.status'),
              role: 'aside',
              cell: (pipeline) => <StatusPill status={pipeline.status} />,
            },
            {
              key: 'duration',
              header: t('dashboard.cols.duration'),
              className: 'num',
              cell: (pipeline) => formatDuration(pipeline.durationSec),
            },
          ]}
        />
      )}
      <Pagination info={list.page} value={page} onChange={setPage} disabled={loading} />
    </>
  );
}

/** A referenced ticket, linked when its rule defines a URL template. */
function TicketPill({ ticket }: { ticket: TicketRef }) {
  const label = (
    <>
      <b>{ticket.tracker.name}</b> {ticket.key}
    </>
  );
  return ticket.url ? (
    <a className="pill attr" href={ticket.url} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : (
    <span className="pill attr">{label}</span>
  );
}

function StatusPill({ status }: { status: PipelineStatus }) {
  const { t } = useTranslation();
  return <span className={`pill status-${status}`}>{t(`status.${status}`)}</span>;
}

function formatDuration(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
