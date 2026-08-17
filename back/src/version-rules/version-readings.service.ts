import { Injectable, Logger } from '@nestjs/common';
import type { VersionProbeOutcome, VersionProbeTrace } from '@repo/shared';
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
import { loggableUrl, preferring, probeUrl, rulesFor, type ProbeSubject } from './version-target';
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
  /**
   * Everything this class says is at `debug`, and deliberately so.
   *
   * A rule that reads nothing is configuration nobody can see from the outside:
   * the row filed against the environment carries the *last* thing that went
   * wrong, and the question being asked — why did my rule not fire — is usually
   * about an address that was never tried. So the walk narrates itself, and
   * `LOG_LEVEL=debug` is what turns it on for as long as somebody is looking.
   *
   * Off by default because it is one line per rule per environment per cycle:
   * priceless for ten minutes, noise for the rest of the year.
   */
  private readonly logger = new Logger(VersionReadingsService.name);

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
      return { probed: 0, skipped: 0, failed: 0, changed: 0, rules: 0, environments: 0, trace: [] };
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
      // Filled as the walk goes, so the environments read appear in the order
      // they were read. What the batch cap deferred is counted in `skipped` and
      // has no trace: nothing was tried, so there is nothing to say about it.
      trace: [],
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
        outcome.trace.push(result.trace);
        if (!result.read) outcome.skipped += 1;
        else {
          outcome.probed += 1;
          if (!result.ok) outcome.failed += 1;
          if (result.changed) outcome.changed += 1;
        }
      }
    }

    this.logger.debug(
      `${sourceId}: ${outcome.rules} rule(s) over ${outcome.environments} environment(s) — ` +
        `${outcome.probed} read, ${outcome.failed} failed, ` +
        `${outcome.changed} changed, ${outcome.skipped} skipped`,
    );
    // The one thing said at the default level, because it is the shape of a
    // misconfiguration rather than of an environment having a bad afternoon:
    // every address tried, none of them answering. Once per source per cycle,
    // and it names what to turn on to find out which addresses those were.
    if (outcome.probed > 0 && outcome.failed === outcome.probed) {
      this.logger.warn(
        `${sourceId}: none of the ${outcome.probed} environment(s) read answered — ` +
          `LOG_LEVEL=debug names every address tried`,
      );
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
    return { read: result.read, changed: result.changed };
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
  ): Promise<EnvironmentReading> {
    const subject = {
      repo: target.repo,
      environment: target.environment,
      ref: target.ref,
      environmentUrl: target.environmentUrl,
      attributes: target.attributes,
    };
    const candidates = preferring(rulesFor(subject, rules), lastAnswered);
    if (candidates.length === 0) {
      // Nothing is filed on this path, so the trace is all it leaves — and "no
      // rule claims this environment" is the commonest reason a version never
      // appears. The rule count is what tells a pattern that matches nothing
      // from a source that opted into no rule at all.
      this.logger.debug(`${where(subject)}: none of the ${rules.length} rule(s) claim it`);
      return { read: false, ok: false, changed: false, trace: toTrace(target, [], null) };
    }
    this.logger.debug(
      `${where(subject)}: trying ${candidates.length} of ${rules.length} rule(s) — ` +
        `${candidates.map((rule) => rule.name).join(' → ')}`,
    );

    const attempts: Attempt[] = [];
    let settled: Attempt | null = null;
    let furthest: Attempt | null = null;
    for (const rule of candidates) {
      const attempt = await this.attempt(rule, subject, signal);
      attempts.push(attempt);
      if (!attempt.tryAnother) {
        settled = attempt;
        break;
      }
      if (!furthest || reach(attempt) > reach(furthest)) furthest = attempt;
    }

    // Non-null by construction: the loop either settles or keeps every attempt
    // it refused, and `candidates` is not empty.
    const outcome = (settled ?? furthest)!;
    // Which of the attempts above became the row, since only one of them does —
    // the one that settled, or the one that got furthest when none did. Without
    // this line a reader has to replay `reach` in their head to know which of
    // the failures they are looking at on the page.
    this.logger.debug(
      `${where(subject)}: filing ${outcome.status}` +
        `${outcome.version === null ? '' : ` ${outcome.version}`}` +
        `${settled ? '' : ' (nothing settled; furthest attempt kept)'}` +
        ` from ${outcome.url === null ? 'no address' : loggableUrl(outcome.url)}`,
    );
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
    return {
      read: outcome.status !== 'skipped',
      ok: outcome.status === 'ok',
      changed,
      trace: toTrace(target, attempts, outcome),
    };
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
      this.logger.debug(
        `${where(subject)} · ${rule.name}: no address — ${address.reason.code} (${rule.urlTemplate})`,
      );
      return {
        ruleId: rule.id,
        rule: rule.name,
        version: null,
        url: null,
        httpStatus: null,
        tookMs: 0,
        status: 'skipped',
        error: address.reason,
        tryAnother: true,
      };
    }

    // Wall clock rather than the probe's own accounting: what a reader is
    // looking for here is the five seconds that mean a timeout, and DNS,
    // connection and body all count towards it.
    const started = Date.now();
    const response = await probe({
      url: address.url,
      headers: rule.headers,
      auth: rule.auth,
      signal,
    });
    const tookMs = Date.now() - started;
    this.logger.debug(
      `${where(subject)} · ${rule.name}: GET ${loggableUrl(address.url)} → ` +
        `${response.status ?? 'no response'} in ${tookMs}ms` +
        `${response.reason ? ` — ${response.reason.code}` : ''}`,
    );
    const made = {
      ruleId: rule.id,
      rule: rule.name,
      url: address.url,
      httpStatus: response.status,
      tookMs,
    };
    if (!response.ok) {
      return { ...made, version: null, status: 'unreachable', error: response.reason, tryAnother: true };
    }

    const extracted = extractVersion(response.body, {
      format: rule.format,
      template: rule.template,
      pattern: rule.pattern,
    });
    if (extracted.ok) {
      this.logger.debug(`${where(subject)} · ${rule.name}: read ${extracted.version}`);
      return { ...made, version: extracted.version, status: 'ok', error: null, tryAnother: false };
    }
    // The distinction `blamesTheAddress` draws, said out loud: the walk either
    // moves on to the next address or stops here with a template to fix, and
    // which of the two it did is not otherwise visible from the row.
    const next = blamesTheAddress(extracted.reason)
      ? 'wrong address; trying the next'
      : 'right address, template to fix; stopping here';
    this.logger.debug(
      `${where(subject)} · ${rule.name}: read nothing — ${extracted.reason.code} (${next})`,
    );
    return {
      ...made,
      version: null,
      status: 'noMatch',
      error: extracted.reason,
      tryAnother: blamesTheAddress(extracted.reason),
    };
  }
}

/**
 * The environment a line is about, as short as it can be said.
 *
 * On every line rather than once per walk: four environments are read at a
 * time, so their lines interleave, and a trace whose steps cannot be told apart
 * is worse than none. A declared environment belongs to no repo and is named on
 * its own, which is also how the store keys it.
 */
function where(subject: { repo: string; environment: string }): string {
  return subject.repo ? `${subject.repo}/${subject.environment}` : subject.environment;
}

/**
 * One environment's reading, as the run that asked for it needs it.
 *
 * `read` rather than a null: a walk that filed nothing still has a trace worth
 * handing back — an environment no rule claims, or one whose every rule refused
 * to resolve, is precisely what somebody who clicked *probe* and got nothing is
 * trying to find out.
 */
interface EnvironmentReading {
  /** Whether a request was made at all — `skipped` reaches no network. */
  read: boolean;
  ok: boolean;
  changed: boolean;
  trace: VersionProbeTrace;
}

/**
 * The walk, as it is handed to whoever asked for the reading.
 *
 * The addresses are stripped of their credentials on the way out and nowhere
 * else: the row keeps what was actually requested, since that is the reading's
 * own record, while this is shown on a page and pasted into tickets.
 */
function toTrace(
  target: ProbeCandidate,
  attempts: Attempt[],
  filed: Attempt | null,
): VersionProbeTrace {
  return {
    repo: target.repo,
    environment: target.environment,
    attempts: attempts.map((attempt) => ({
      ruleId: attempt.ruleId,
      rule: attempt.rule,
      url: attempt.url === null ? null : loggableUrl(attempt.url),
      httpStatus: attempt.httpStatus,
      status: attempt.status,
      version: attempt.version,
      error: attempt.error ?? null,
      tookMs: attempt.tookMs,
      filed: attempt === filed,
    })),
  };
}

/** What one rule made of one environment, before anything is filed. */
interface Attempt {
  ruleId: string;
  /** Carried beside the id so a trace reads without a second lookup. */
  rule: string;
  version: string | null;
  url: string | null;
  /** Null when no response arrived, and when no request was made. */
  httpStatus: number | null;
  /** Wall clock of the request, zero when none was made. */
  tookMs: number;
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
