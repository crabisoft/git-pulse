import { Injectable } from '@nestjs/common';
import type { ConnectionTestResult, Incident } from '@repo/shared';
import { octokitFor } from '../sources/connectors/github.connector';
import type { IncidentContext, IncidentProvider } from './incident-provider.interface';

/** Incidents from GitHub issues, on the source's own credentials. */
@Injectable()
export class GitHubIncidentProvider implements IncidentProvider {
  readonly kind = 'github';

  async testConnection(ctx: IncidentContext): Promise<ConnectionTestResult> {
    const repo = ctx.repos[0];
    if (!repo) {
      return { ok: false, message: { code: 'incidents.test.noRepo' } };
    }
    try {
      const gh = octokitFor(ctx.access);
      await gh.rest.issues.listForRepo({
        owner: ctx.access.scope.owner,
        repo,
        per_page: 1,
        state: 'all',
      });
      return { ok: true, message: { code: 'incidents.test.ok', params: { repo } } };
    } catch (e) {
      return {
        ok: false,
        message: { code: 'incidents.test.failed', params: { error: asMessage(e) } },
      };
    }
  }

  async listIncidents(
    ctx: IncidentContext,
    range: { from: string; to: string },
  ): Promise<Incident[]> {
    const gh = octokitFor(ctx.access);
    // GitHub's `labels` filter is AND, so one call per label and dedup. Labels
    // are few and incidents rare — cheaper than listing every issue and sorting
    // them out here.
    const byId = new Map<string, Incident>();

    for (const repo of ctx.repos) {
      ctx.access.signal?.throwIfAborted();
      for (const label of ctx.labels) {
        const issues = await gh.rest.issues.listForRepo({
          owner: ctx.access.scope.owner,
          repo,
          state: 'all',
          labels: label,
          // Filters on updated_at: a superset of what the range needs, narrowed
          // on `openedAt` by the caller.
          since: range.from,
          per_page: 100,
        });
        for (const issue of issues.data) {
          // The issues endpoint also returns pull requests.
          if (issue.pull_request) continue;
          byId.set(`gh:${repo}:${issue.number}`, {
            id: `gh:${repo}:${issue.number}`,
            key: `#${issue.number}`,
            title: issue.title,
            url: issue.html_url,
            openedAt: issue.created_at,
            resolvedAt: issue.closed_at,
            labels: issue.labels.map(labelName).filter(Boolean),
            repo,
          });
        }
      }
    }
    return [...byId.values()];
  }
}

/** GitHub types a label as either a bare string or an object. */
function labelName(label: string | { name?: string }): string {
  return typeof label === 'string' ? label : (label.name ?? '');
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
