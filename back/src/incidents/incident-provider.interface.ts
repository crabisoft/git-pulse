import type { ConnectionTestResult, Incident } from '@repo/shared';
import type { ConnectorContext } from '../sources/connectors/source-connector.interface';

/**
 * What a provider needs to fetch incidents. Deliberately separate from
 * `ConnectorContext`: a standalone tracker (Jira, Linear) has no repos and no
 * Git credentials, so `access` will widen into a union the day one lands —
 * everything else here stays valid.
 */
export interface IncidentContext {
  /** Platform access. Git-hosted trackers reuse their Git source's credentials. */
  access: ConnectorContext;
  /** Where to look. Empty means the whole scope the access allows. */
  repos: string[];
  /**
   * An issue is an incident when it carries one of these labels — OR, not AND.
   * Never empty: the settings refuse to enable incidents without one.
   */
  labels: string[];
}

/**
 * Common contract for every incident tracker. Two methods on purpose: GitHub
 * issues, GitLab issues, Jira and Linear have nothing else in common, and a
 * wider interface would be one no standalone tracker could honour.
 */
export interface IncidentProvider {
  readonly kind: string;

  testConnection(ctx: IncidentContext): Promise<ConnectionTestResult>;

  /** Incidents opened or updated within the range, resolved or not. */
  listIncidents(ctx: IncidentContext, range: { from: string; to: string }): Promise<Incident[]>;
}
