import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type {
  ChangelogArchiveOutcome,
  ChangelogFilters,
  ChangelogReport,
  ClassifiedDeployment,
  DeploymentChanges,
  DeploymentChangelog,
  ReleaseNotesGenerator,
} from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import { resolvePeriod } from '../common/period';
import type { PageWindow } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';
import { ApiQuotaService } from '../api-quota/api-quota.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { ChangelogStore, type ChangelogWindow, type NewChangelog } from './changelog.store';
import { selectPending } from './pending';

/**
 * Writes down what deployments carried, and reads it back later.
 *
 * The reason it exists at all is that a deployment is the most perishable thing
 * this install reports on. Its environment gets torn down, its branch deleted,
 * its record aged out of the provider's API — and the comparison that says what
 * went out stops being computable, quietly and for ever. Everything else here
 * is a cache of the platform; this is the one thing that is not.
 *
 * So it runs with the collection rather than on a reader's request: by the time
 * somebody asks what shipped in March, March is unreadable.
 */
@Injectable()
export class ChangelogsService {
  private readonly logger = new Logger(ChangelogsService.name);

  constructor(
    private readonly store: ChangelogStore,
    private readonly deployments: DeploymentsService,
    private readonly settings: SettingsService,
    private readonly quotas: ApiQuotaService,
  ) {}

  /** The archive of one source, narrowed and windowed. */
  async list(
    sourceId: string,
    filters: ChangelogFilters,
    bounds: ChangelogWindow,
    window: PageWindow,
  ): Promise<ChangelogReport> {
    const [changelogs, vocabulary, lastArchivedAt] = await Promise.all([
      this.store.list(sourceId, filters, bounds, window),
      this.store.vocabularies(sourceId),
      this.store.lastArchivedAt(sourceId),
    ]);
    return {
      changelogs,
      repos: vocabulary.repos,
      environments: vocabulary.environments,
      lastArchivedAt: lastArchivedAt?.toISOString() ?? null,
    };
  }

  /** One filed changelog, for the page that opens a single deployment. */
  async get(sourceId: string, deploymentId: string): Promise<DeploymentChangelog> {
    const filed = await this.store.find(sourceId, deploymentId);
    if (!filed) {
      throw new CodedException('errors.changelog.notFound', HttpStatus.NOT_FOUND, {
        id: deploymentId,
      });
    }
    return filed;
  }

  /**
   * Files every successful deployment of the window that is not filed yet.
   *
   * Bounded twice over, because it runs behind a collection nobody watches: by
   * the batch size, and by the rate-limit reserve — the same one the enrichment
   * calls respect, checked between deployments rather than before the run, so a
   * budget going scarce halfway stops it where it is instead of after it.
   *
   * A deployment that cannot be read is not a failed run: the rest of the batch
   * is still worth filing, and this one is retried next cycle for as long as it
   * remains in the store.
   */
  async archive(sourceId: string): Promise<ChangelogArchiveOutcome> {
    const { doraWindowDays, quotaReservePct, releaseNotesGenerator } = await this.settings.get();
    const period = resolvePeriod({}, doraWindowDays);
    const classified = await this.deployments.classified(sourceId, period);
    const filed = await this.store.known(
      sourceId,
      classified.map((d) => d.id),
    );

    const { targets, known, deferred } = selectPending(classified, filed);
    const outcome: ChangelogArchiveOutcome = {
      archived: 0,
      known,
      deferred,
      unreadable: 0,
      failed: 0,
    };
    const subject = { kind: 'source' as const, id: sourceId };

    for (const [i, target] of targets.entries()) {
      if (!this.quotas.allowsOptional(subject, quotaReservePct)) {
        outcome.deferred += targets.length - i;
        this.logger.warn(
          `Archivage des changelogs interrompu pour ${sourceId} : réserve d'API atteinte, ` +
            `${targets.length - i} déploiement(s) reportés.`,
        );
        break;
      }
      try {
        const changes = await this.carried(sourceId, target, classified);
        await this.store.record(sourceId, toRecord(target, changes, releaseNotesGenerator));
        outcome.archived += 1;
      } catch (e) {
        // A platform that will not resolve the refs is the end of the matter,
        // not a hitch: it does not become false again, and a deployment retried
        // every cycle would hold the batch against the ones still readable. So
        // it is filed as what it is — this went out, and what it carried is no
        // longer knowable. Anything else (a network blip, a 5xx) is left
        // unfiled and comes back round.
        if (isUnresolvable(e)) {
          await this.store.record(sourceId, toUnreadable(target, releaseNotesGenerator));
          outcome.unreadable += 1;
          this.logger.warn(
            `Contenu introuvable pour le déploiement ${target.id} (${target.repo} @ ${target.ref}) : ` +
              `archivé sans contenu — ${asMessage(e)}`,
          );
        } else {
          outcome.failed += 1;
          this.logger.warn(
            `Changelog non archivé pour le déploiement ${target.id} (${target.repo}) : ${asMessage(e)}`,
          );
        }
      }
    }

    if (outcome.archived > 0) {
      this.logger.log(
        `${outcome.archived} changelog(s) de déploiement archivé(s) pour ${sourceId}.`,
      );
    }
    return outcome;
  }

  /**
   * What a deployment carried against its predecessor, or — when that is
   * nothing — what it carries against the default branch.
   *
   * Two ordinary cases file an empty comparison: a deployment that went out on
   * a ref its predecessor already ran, and a first deployment, which has no
   * predecessor to compare against at all. Both leave a row reading "0 commits"
   * where a reader is asking what is running on that environment, and the
   * branch the ref was cut from still answers it.
   *
   * Worth the second comparison here and nowhere else: this record is written
   * once and read for months, long after the refs it names have gone. The
   * deployments page asks the platform live, and the base it compares against
   * is the reader's own choice.
   */
  private async carried(
    sourceId: string,
    target: ClassifiedDeployment,
    classified: ClassifiedDeployment[],
  ): Promise<DeploymentChanges> {
    const carried = await this.deployments.contentsOf(sourceId, target, classified);
    if (carried.entries.length > 0) return carried;

    try {
      const againstDefault = await this.deployments.contentsOf(
        sourceId,
        target,
        classified,
        'default',
      );
      // Kept only if it carries something. A ref that is the default branch, or
      // one already merged into it, compares empty both ways — and "nothing new
      // since the last deployment" is the truer of the two readings.
      return againstDefault.entries.length > 0 ? againstDefault : carried;
    } catch (e) {
      // The predecessor comparison answered, and it is what would have been
      // filed before this fallback existed. A default branch that will not
      // compare — deleted, renamed, or a repo the platform has stopped
      // resolving — is a reason to file that answer, not to lose it.
      this.logger.warn(
        `Comparaison avec la branche par défaut impossible pour le déploiement ${target.id} ` +
          `(${target.repo} @ ${target.ref}) : comparaison vide conservée — ${asMessage(e)}`,
      );
      return carried;
    }
  }
}

/**
 * The record a filing writes: the comparison, plus what it was about.
 *
 * The generator is passed in rather than read off the text: it is the setting
 * `contentsOf` just rendered through, and storing it is what keeps a reader
 * from comparing two changelogs written by different renderers without knowing
 * which was which.
 */
function toRecord(
  target: ClassifiedDeployment,
  changes: DeploymentChanges,
  generator: ReleaseNotesGenerator,
): NewChangelog {
  return {
    deploymentId: target.id,
    repo: target.repo,
    environment: target.environment,
    ref: target.ref,
    baseRef: changes.baseRef,
    base: changes.base,
    refUrl: target.refUrl,
    baseRefUrl: changes.baseRefUrl,
    deploymentUrl: target.url,
    environmentUrl: target.environmentUrl,
    status: target.status,
    entries: changes.entries,
    markdown: changes.markdown,
    authors: changes.authors,
    unreadable: false,
    generator,
    deployedAt: target.createdAt,
  };
}

/**
 * The record for a deployment whose contents the platform will not give up.
 *
 * Filed rather than skipped, and worth filing: it says this deployment happened,
 * on this ref, at this time — which the store itself will stop saying in a few
 * weeks — and that what it carried is gone. A reader is better served by that
 * than by a gap they cannot tell from a deployment that never happened.
 */
function toUnreadable(
  target: ClassifiedDeployment,
  generator: ReleaseNotesGenerator,
): NewChangelog {
  return {
    deploymentId: target.id,
    repo: target.repo,
    environment: target.environment,
    ref: target.ref,
    // No base at all: the comparison never happened, so naming one it was going
    // to be made against would state a range nobody ever read.
    baseRef: null,
    base: 'previous',
    refUrl: target.refUrl,
    baseRefUrl: null,
    deploymentUrl: target.url,
    environmentUrl: target.environmentUrl,
    status: target.status,
    entries: [],
    markdown: '',
    authors: 0,
    unreadable: true,
    generator,
    deployedAt: target.createdAt,
  };
}

/**
 * Whether the platform stated the refs are gone, rather than merely failing.
 *
 * Read off the code the connectors raise, not off the status: a 404 could come
 * from anywhere, and only that code means "these refs do not resolve" — which
 * is the one failure that will never resolve itself.
 */
function isUnresolvable(e: unknown): boolean {
  if (!(e instanceof HttpException)) return false;
  const body = e.getResponse();
  const code =
    typeof body === 'object' && body !== null && 'code' in body
      ? (body as { code?: unknown }).code
      : null;
  return typeof code === 'string' && code.startsWith('errors.compare.');
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
