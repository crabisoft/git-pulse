import type { Queue } from 'bullmq';
import { isJobSettled, type JobState } from '@repo/shared';
import { JOB_HISTORY } from '../common/job-options';
import { PROBE_SETTLE_SECONDS } from './version-readings.service';

export const PROBE_QUEUE = 'versions';
export const PROBE_JOB = 'probe-environment';

/** What a queued reading needs. Its target is resolved when it runs, not here. */
export interface ProbeJobData {
  sourceId: string;
  repo: string;
  environment: string;
  /** Which attempt this is; absent means the first. See `PROBE_RETRY_ATTEMPTS`. */
  attempt?: number;
}

/**
 * The id a queued reading is deduplicated on.
 *
 * Derived from the **pair**, not from the deployment: one deployment emits
 * several status events, and BullMQ refusing a duplicate id is what turns them
 * into a single reading — the same trick `queueRefresh` uses to stop a second
 * click from spending a second API budget.
 *
 * Two deployments landing on one environment a minute apart collapse into one
 * reading too, and that is right rather than merely tolerable: the job resolves
 * its target when it runs, so the surviving reading describes whichever
 * deployment actually went out last. Reading the first would describe a state
 * that no longer exists.
 */
export function probeJobId(sourceId: string, repo: string, environment: string): string {
  return `probe:${sourceId}:${repo}:${environment}`;
}

/**
 * Queues a reading for one environment, unless one is already waiting.
 *
 * **Never retried by BullMQ.** A reading that failed because the application
 * was unreachable *is* a reading: it is filed as one and the page says so, and
 * three attempts would file the same failure three times while calling
 * somebody's production application three times to do it. The one retry this
 * path wants is a different question — the version not having moved yet — and
 * only the processor, which has seen what came back, can ask it.
 *
 * A settled job holding the id is a result kept for the history, not a claim on
 * the environment: it is removed so the new event can be honoured. One still
 * waiting or running is left alone — that is the debounce.
 *
 * Returns whether a reading was queued, which is what the tests assert on and
 * what a caller would log.
 */
export async function enqueueProbe(queue: Queue, data: ProbeJobData): Promise<boolean> {
  const id = probeJobId(data.sourceId, data.repo, data.environment);
  const existing = await queue.getJob(id);
  if (existing) {
    const state = (await existing.getState()) as JobState;
    if (!isJobSettled(state)) return false;
    await existing.remove();
  }

  await queue.add(PROBE_JOB, data, {
    ...JOB_HISTORY,
    attempts: 1,
    jobId: id,
    // The settling delay: an event says the platform considers the deployment
    // done, which is before the application has finished coming back up.
    delay: PROBE_SETTLE_SECONDS * 1000,
  });
  return true;
}
