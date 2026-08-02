import { Injectable } from '@nestjs/common';
import type { VersionProbeOutcome } from '@repo/shared';
import { resolvePeriod } from '../common/period';
import { SettingsService } from '../settings/settings.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { VersionRulesService, type ResolvedVersionRule } from './version-rules.service';
import { VersionReadingStore, type NewReading } from './version-reading.store';
import { EnvUrlsService } from '../env-urls/env-urls.service';
import {
  PROBE_BATCH,
  PROBE_MIN_INTERVAL_MINUTES,
  latestPerEnvironment,
  pairKey,
  selectProbes,
  withDeclared,
  type ProbeCandidate,
} from './pending-probes';
import { preferring, probeUrl, rulesFor, type ProbeSubject } from './version-target';
import { probe } from './version-probe';
import { blamesTheAddress, extractVersion } from './version-template';

/**
 * How many environments are read at once.
 *
 * Sequential would be gentler still, but twenty-five environments at five
 * seconds each is two minutes of a collection cycle that runs every few
 * minutes. Four at a time keeps the worst case inside the cycle without ever
 * looking like a burst to whoever is on the other end.
 */
const PROBE_CONCURRENCY = 4;

/**
 * How long a reading waits after a deployment event before it is taken.
 *
 * An event arrives when the platform says the deployment succeeded, which is
 * before the application has finished coming back up: read at once and the
 * answer is the version being replaced, frozen for ever against the deployment
 * that replaced it. Half a minute is enough for most restarts and short enough
 * that a reader watching a release does not give up on the page.
 *
 * Not a setting. It is a property of applications restarting rather than of
 * this install, and one retry — see `PROBE_RETRY_ATTEMPTS` — covers the ones
 * that take longer far better than a number nobody knows how to choose.
 */
export const PROBE_SETTLE_SECONDS = 30;

/**
 * How many times an event-driven reading may be taken.
 *
 * Two: one after the settling delay, and one more when the environment still
 * answers the version it answered before — which usually means it had not
 * restarted yet. Never a loop. A redeployment of the same version is perfectly
 * legitimate and looks exactly like an application that has not come back, so
 * the second reading is where it stops: what was read is filed either way, and
 * an unchanged version is a reading, not a failure.
 */
export const PROBE_RETRY_ATTEMPTS = 2;

/** What one environment's event-driven reading did. */
export interface DeploymentProbeOutcome {
  /** Whether a request was made at all — no rule claimed it, or nothing to read. */
  read: boolean;
  /** Whether the version differs from the one filed before it. */
  changed: boolean;
}

/** How a run was started, which is the only thing that changes what it reads. */
export interface ProbeOptions {
  /**
   * Read every environment that has one, whatever the interval says.
   *
   * Set by the route and never by the collection: the interval spares a cron
   * its repetitions, and there is nothing to spare when a person is waiting
   * for the answer. Without it a manual run three minutes after a reading
   * would report `skipped` and look broken.
   */
  force?: boolean;
}

/**
 * Reads what each environment is running, and files it.
 *
 * Runs with the collection rather than on a reader's request, for a reason the
 * archive shares: a version is only true at a moment. Asking the environment
 * when somebody opens the page would answer for the instant they looked, cost a
 * request per visitor, and say nothing about the fortnight nobody was looking.
 */
@Injectable()
export class VersionReadingsService {
  constructor(
    private readonly rules: VersionRulesService,
    private readonly store: VersionReadingStore,
    private readonly deployments: DeploymentsService,
    private readonly settings: SettingsService,
    private readonly envUrls: EnvUrlsService,
  ) {}

  /**
   * Reads every environment of a source that is due one.
   *
   * The rules are read first and the run gives up when there are none: an
   * install that configured no version rule must not pay a deployment listing
   * per collection to discover that it still has nothing to read.
   */
  async probeSource(
    sourceId: string,
    options: ProbeOptions = {},
    signal?: AbortSignal,
  ): Promise<VersionProbeOutcome> {
    const rules = await this.rules.resolvedFor(sourceId);
    if (rules.length === 0) {
      return { probed: 0, skipped: 0, failed: 0, changed: 0, rules: 0, environments: 0 };
    }

    const period = resolvePeriod({}, (await this.settings.get()).doraWindowDays);
    const deployments = await this.deployments.classified(sourceId, period, signal);
    const readings = await this.store.lastReadings(sourceId);
    // The declared environments come in beside the deployed ones and are read
    // on the same terms: an appliance at a customer's site is exactly what
    // nobody can otherwise find out the version of.
    const candidates = withDeclared(
      latestPerEnvironment(deployments),
      await this.envUrls.declaredFor(sourceId),
    );
    const selection = selectProbes(
      candidates,
      readings,
      new Date(),
      PROBE_BATCH,
      // Somebody asked, so the interval that exists to spare a cron its
      // repetitions has nothing to say: a reading taken three minutes ago is
      // exactly what they are trying to replace. The batch cap stays whoever
      // asked — a click is not a reason to open two hundred connections, and
      // what it leaves behind comes back as `skipped`.
      options.force ? 0 : PROBE_MIN_INTERVAL_MINUTES,
    );

    const outcome: VersionProbeOutcome = {
      probed: 0,
      skipped: selection.skipped + selection.deferred,
      failed: 0,
      changed: 0,
      rules: rules.length,
      environments: candidates.length,
    };

    for (let i = 0; i < selection.targets.length; i += PROBE_CONCURRENCY) {
      const batch = selection.targets.slice(i, i + PROBE_CONCURRENCY);
      const results = await Promise.all(
        batch.map((target) =>
          this.readOne(
            sourceId,
            target,
            rules,
            // Starting where an environment last answered saves the addresses
            // that do not exist, which is worth having on a cron and wrong
            // under a person's finger: somebody who has just written a rule and
            // asked for a reading is asking what their rules do *now*, and a
            // remembered one answering first is how a new rule gets written,
            // attached, and never tried. The declared order is what they wrote.
            options.force ? null : readings.get(pairKey(target.repo, target.environment))?.ruleId,
            signal,
          ),
        ),
      );
      for (const result of results) {
        if (result === null) outcome.skipped += 1;
        else {
          outcome.probed += 1;
          if (!result.ok) outcome.failed += 1;
          if (result.changed) outcome.changed += 1;
        }
      }
    }

    return outcome;
  }

  /**
   * Reads one environment because something was just deployed to it.
   *
   * Scoped to the pair the event named, which is the whole point of having an
   * event: a source with forty environments has thirty-nine that nothing
   * happened to. The interval never applies — a deployment that has just landed
   * is the one reason to read that outranks everything else — and the target is
   * resolved **now** rather than carried on the job, so two deployments landing
   * a minute apart on the same environment settle to one reading of whichever
   * actually went out last.
   *
   * Writes through `record` like every other path, so the frozen row lands with
   * no second mechanism.
   */
  async probeDeployment(
    sourceId: string,
    repo: string,
    environment: string,
    signal?: AbortSignal,
  ): Promise<DeploymentProbeOutcome> {
    const rules = await this.rules.resolvedFor(sourceId);
    if (rules.length === 0) return { read: false, changed: false };

    const period = resolvePeriod({}, (await this.settings.get()).doraWindowDays);
    const deployments = await this.deployments.classified(sourceId, period, signal);
    const target = latestPerEnvironment(
      deployments.filter((d) => d.repo === repo && d.environment === environment),
    )[0];
    // Nothing successful on that pair inside the window: the event described a
    // deployment the store has not caught up with, or one that has since been
    // rolled past. Either way there is nothing to read against.
    if (!target) return { read: false, changed: false };

    // The address that answered last time, so a deployment event starts where
    // the collection left off rather than walking the rules from the top.
    const readings = await this.store.lastReadings(sourceId);
    const result = await this.readOne(
      sourceId,
      target,
      rules,
      readings.get(pairKey(repo, environment))?.ruleId,
      signal,
    );
    return { read: result !== null, changed: result?.changed ?? false };
  }

  /**
   * Reads one environment, trying each address that claims it until one
   * answers. Null means no request was made at all — no rule claimed the
   * environment, or none of those that did could be addressed.
   *
   * One application may state its version at more than one address, and which
   * one it uses is a property of that environment: the actuator on the installs
   * upgraded this year, a static file on the ones that are not. So the rules
   * claiming an environment are candidates in turn rather than one selection —
   * `lastAnswered` first, then by priority, and the walk stops at the first that
   * **reached the application**, which is not the same as the first that
   * answered at all:
   *
   * - a request that fails, or a body that is not the format the rule declared,
   *   is another address to try — see `blamesTheAddress`;
   * - a body that parses as declared has found the application, and the walk
   *   ends there whether or not the template read a version out of it. A `200`
   *   alone would not do: a proxy answers `200` on every path, and a rule
   *   stopping there would file nothing for ever while looking reachable.
   *
   * Every address refusing files the attempt that got furthest, so what is
   * shown is the closest thing to a working address rather than whichever
   * happened to be tried last. A rule that matched but could not produce a URL
   * still counts as an attempt: it says this environment has a rule and the
   * rule cannot reach it, which is exactly what an author has no other way of
   * finding out.
   */
  private async readOne(
    sourceId: string,
    target: ProbeCandidate,
    rules: ResolvedVersionRule[],
    lastAnswered?: string | null,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; changed: boolean } | null> {
    const subject = {
      repo: target.repo,
      environment: target.environment,
      ref: target.ref,
      environmentUrl: target.environmentUrl,
      attributes: target.attributes,
    };
    const candidates = preferring(rulesFor(subject, rules), lastAnswered);
    if (candidates.length === 0) return null;

    let settled: Attempt | null = null;
    let furthest: Attempt | null = null;
    for (const rule of candidates) {
      const attempt = await this.attempt(rule, subject, signal);
      if (!attempt.tryAnother) {
        settled = attempt;
        break;
      }
      if (!furthest || reach(attempt) > reach(furthest)) furthest = attempt;
    }

    // Non-null by construction: the loop either settles or keeps every attempt
    // it refused, and `candidates` is not empty.
    const outcome = (settled ?? furthest)!;
    const changed = await this.store.record(sourceId, {
      repo: target.repo,
      environment: target.environment,
      observedAt: new Date(),
      // A deployed candidate is the latest **successful** deployment of its
      // environment — see `latestPerEnvironment` — so the store freezes the
      // reading against that deployment as well as overwriting the current
      // state. A declared environment has no deployment to freeze against: the
      // reading is true and current, and belongs to nothing.
      deployedAt: target.deployedAt ? new Date(target.deployedAt) : null,
      deploymentId: target.deploymentId,
      ref: target.ref,
      version: outcome.version,
      ruleId: outcome.ruleId,
      url: outcome.url,
      status: outcome.status,
      error: outcome.error,
    });

    // `skipped` is the one outcome that reached no network, and the caller
    // counts it apart for that reason.
    return outcome.status === 'skipped' ? null : { ok: outcome.status === 'ok', changed };
  }

  /** One rule tried against one environment, filing nothing. */
  private async attempt(
    rule: ResolvedVersionRule,
    subject: ProbeSubject,
    signal?: AbortSignal,
  ): Promise<Attempt> {
    const address = probeUrl(rule, subject);
    if (!address.ok) {
      // Nothing was asked, so nothing was learnt about the address: another
      // rule addressing the same environment differently may well resolve.
      return { ruleId: rule.id, version: null, url: null, status: 'skipped', error: address.reason, tryAnother: true };
    }

    const response = await probe({
      url: address.url,
      headers: rule.headers,
      auth: rule.auth,
      signal,
    });
    if (!response.ok) {
      return {
        ruleId: rule.id,
        version: null,
        url: address.url,
        status: 'unreachable',
        error: response.reason,
        tryAnother: true,
      };
    }

    const extracted = extractVersion(response.body, {
      format: rule.format,
      template: rule.template,
      pattern: rule.pattern,
    });
    if (extracted.ok) {
      return {
        ruleId: rule.id,
        version: extracted.version,
        url: address.url,
        status: 'ok',
        error: null,
        tryAnother: false,
      };
    }
    return {
      ruleId: rule.id,
      version: null,
      url: address.url,
      status: 'noMatch',
      error: extracted.reason,
      tryAnother: blamesTheAddress(extracted.reason),
    };
  }
}

/** What one rule made of one environment, before anything is filed. */
interface Attempt {
  ruleId: string;
  version: string | null;
  url: string | null;
  status: NewReading['status'];
  error: NewReading['error'];
  /** Whether the failure blames the address, leaving another worth trying. */
  tryAnother: boolean;
}

/**
 * How far a refused attempt got, so the one filed is the most informative.
 *
 * An address that answered with the wrong thing is a closer near-miss than one
 * that never answered, which is closer than a template that never produced an
 * address at all. Filing the last attempt instead would report whichever rule
 * happened to sort last, which tells the reader nothing about the others.
 */
function reach(attempt: Attempt): number {
  if (attempt.status === 'noMatch') return 2;
  return attempt.status === 'unreachable' ? 1 : 0;
}
