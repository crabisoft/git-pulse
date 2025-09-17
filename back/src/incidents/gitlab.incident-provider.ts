import { Injectable } from '@nestjs/common';
import type { ConnectionTestResult, Incident } from '@repo/shared';
import { gitlabFor } from '../sources/connectors/gitlab.connector';
import type { IncidentContext, IncidentProvider } from './incident-provider.interface';

/** Incidents from GitLab issues, on the source's own credentials. */
@Injectable()
export class GitLabIncidentProvider implements IncidentProvider {
  readonly kind = 'gitlab';

  async testConnection(ctx: IncidentContext): Promise<ConnectionTestResult> {
    const repo = ctx.repos[0];
    if (!repo) {
      return { ok: false, message: { code: 'incidents.test.noRepo' } };
    }
    try {
      const gl = gitlabFor(ctx.access);
      await gl.Issues.all({ projectId: repo, perPage: 1 });
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
    const gl = gitlabFor(ctx.access);
    // Same as GitHub: `labels` is AND on this API too, so one call per label.
    const byId = new Map<string, Incident>();

    for (const repo of ctx.repos) {
      ctx.access.signal?.throwIfAborted();
      for (const label of ctx.labels) {
        const issues = await gl.Issues.all({
          projectId: repo,
          labels: label,
          updatedAfter: range.from,
          perPage: 100,
        });
        for (const issue of issues) {
          const iid = issue.iid as number;
          byId.set(`gl:${repo}:${iid}`, {
            id: `gl:${repo}:${iid}`,
            key: `#${iid}`,
            title: issue.title as string,
            url: issue.web_url as string,
            openedAt: issue.created_at as string,
            resolvedAt: (issue.closed_at as string | null) ?? null,
            labels: (issue.labels as string[] | undefined) ?? [],
            repo,
          });
        }
      }
    }
    return [...byId.values()];
  }
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
