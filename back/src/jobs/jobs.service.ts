import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import {
  JOB_SCAN_DEPTH,
  JOB_STATES,
  QUEUE_NAMES,
  type CodedMessage,
  type JobFailure,
  type JobRunning,
  type JobState,
  type JobStatus,
  type JobWarning,
  type JobsSnapshot,
  type Page,
  type QueueName,
  type QueueSummary,
  type RepeatableJobPublic,
} from '@repo/shared';
import { CodedException } from '../common/coded-exception';
import { paginate, type PageWindow } from '../common/pagination';

/** The states a summary counts. Deliberately not `waiting-children`: nothing here has any. */
const COUNTED = ['waiting', 'active', 'completed', 'failed', 'delayed'] as const;

/**
 * Reads the queues back, and acts on a job somebody wants another go at.
 *
 * Everything here is a reading of Redis at the instant, which is the whole
 * point: BullMQ is the only place that knows what is waiting, what is running
 * and what gave up, and none of it is mirrored into Postgres. What that costs
 * is that a Redis flush loses the history — see the retention in
 * `common/job-options`, which is what decides how much history there is at all.
 */
@Injectable()
export class JobsService {
  private readonly queues: Record<QueueName, Queue>;

  constructor(
    @InjectQueue('collection') collection: Queue,
    @InjectQueue('ingest') ingest: Queue,
    @InjectQueue('versions') versions: Queue,
  ) {
    this.queues = { collection, ingest, versions };
  }

  /**
   * Every queue in one call.
   *
   * An unreachable Redis is reported as a value rather than thrown: it is the
   * one answer the page most needs, and the least visible otherwise — the API
   * keeps serving stored data perfectly well while nothing at all is being
   * collected behind it.
   */
  async snapshot(): Promise<JobsSnapshot> {
    const observedAt = new Date().toISOString();
    try {
      const queues = await Promise.all(QUEUE_NAMES.map((name) => this.summarize(name)));
      return { queues, observedAt, unreachable: null };
    } catch (e) {
      return {
        queues: [],
        observedAt,
        unreachable: { code: 'errors.jobs.unreachable', params: { error: asMessage(e) } },
      };
    }
  }

  /**
   * The failed jobs, newest first, one queue or all of them.
   *
   * Merged and windowed here rather than by Redis: a window over two queues has
   * no meaning to either of them. Only the most recent JOB_SCAN_DEPTH of each
   * are read back — the counts in the summary above are what states how many
   * there really are, and they are not capped by this.
   */
  async failures(queue: QueueName | undefined, window: PageWindow): Promise<Page<JobFailure>> {
    const failed = await this.scan(queue, (q) => q.getFailed(0, JOB_SCAN_DEPTH - 1), toFailure);
    return paginate(failed, window);
  }

  /**
   * What is in flight: running first, then what is queued behind it.
   *
   * The counts alone cannot tell a queue that is working from one that is
   * stuck — both read as "2 active". Ordered oldest first within each state,
   * so the job that is not finishing sits at the top rather than scrolling
   * away among the ones that are.
   */
  async running(queue: QueueName | undefined, window: PageWindow): Promise<Page<JobRunning>> {
    const names = queue ? [queue] : [...QUEUE_NAMES];
    try {
      const perQueue = await Promise.all(
        names.map(async (name) => {
          const q = this.queues[name];
          // Three reads rather than one: BullMQ keeps a list per state, and
          // `getJobs` over several of them cannot be windowed per state.
          const [active, waiting, delayed] = await Promise.all([
            q.getActive(0, JOB_SCAN_DEPTH - 1),
            q.getWaiting(0, JOB_SCAN_DEPTH - 1),
            q.getDelayed(0, JOB_SCAN_DEPTH - 1),
          ]);
          return [
            ...active.map((job) => toRunning(name, 'active', job)),
            ...waiting.map((job) => toRunning(name, 'waiting', job)),
            ...delayed.map((job) => toRunning(name, 'delayed', job)),
          ];
        }),
      );
      return paginate(perQueue.flat().sort(byInFlight), window);
    } catch (e) {
      throw unreachable(e);
    }
  }

  /**
   * The runs that completed having given up on part of their work.
   *
   * Read off what the job returned, which is the only place it exists: a
   * degraded collection is a success as far as the queue is concerned, and
   * counting it as one is exactly how an install ends up green while a source
   * has stopped moving.
   */
  async degraded(queue: QueueName | undefined, window: PageWindow): Promise<Page<JobWarning>> {
    const runs = await this.scan(queue, (q) => q.getCompleted(0, JOB_SCAN_DEPTH - 1), toWarning);
    // Filtered before it is windowed: a page of the completed jobs would be a
    // page of mostly clean runs, and the degraded ones would fall off the end.
    return paginate(
      runs.filter((run) => run.warnings.length > 0),
      window,
    );
  }

  /** Reads one state back across the queues, newest first. */
  private async scan<T extends { failedAt?: string | null; finishedAt?: string | null }>(
    queue: QueueName | undefined,
    read: (queue: Queue) => Promise<Job[]>,
    map: (queue: QueueName, job: Job) => T,
  ): Promise<T[]> {
    const names = queue ? [queue] : [...QUEUE_NAMES];
    try {
      const perQueue = await Promise.all(
        names.map(async (name) => (await read(this.queues[name])).map((job) => map(name, job))),
      );
      return perQueue.flat().sort(byEndedDesc);
    } catch (e) {
      throw unreachable(e);
    }
  }

  /**
   * One job, as whoever started it needs to follow it.
   *
   * A missing job is reported as `unknown` rather than thrown, unlike every
   * other lookup here: this one is polled by a page holding an id it was given
   * minutes ago, and the queue's own history bounds will eventually evict it.
   * A 404 there would read as an error where the honest answer is "it ran, and
   * this is no longer able to say how it went".
   */
  async status(queue: string, id: string): Promise<JobStatus> {
    const name = assertQueueName(queue);
    const job = await this.queues[name].getJob(id).catch((e) => {
      throw unreachable(e);
    });
    if (!job) return absent(name, id);

    const state = await job.getState().catch(() => 'unknown');
    const returned = job.returnvalue as { warnings?: CodedMessage[] } | null;
    return {
      queue: name,
      id: String(job.id),
      name: job.name,
      state: toJobState(state),
      // BullMQ types progress as unknown: anything a job cared to report. Only
      // a number means anything to a caller drawing a bar.
      progress: typeof job.progress === 'number' ? job.progress : null,
      error: job.failedReason ? { code: 'errors.jobs.failed', params: { error: job.failedReason } } : null,
      warnings: returned?.warnings ?? [],
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    };
  }

  /** Puts a failed job back at the front of its queue. */
  async retry(queue: string, id: string): Promise<void> {
    const job = await this.job(queue, id);
    const state = await job.getState();
    // BullMQ refuses it anyway; refusing it here is what turns the refusal into
    // something the page can say — a job somebody else already retried is
    // running, not broken.
    if (state !== 'failed') {
      throw new CodedException('errors.jobs.notFailed', HttpStatus.CONFLICT, { state });
    }
    await job.retry();
  }

  /** Drops it for good — what is left of a failure nobody is going to act on. */
  async discard(queue: string, id: string): Promise<void> {
    await (await this.job(queue, id)).remove();
  }

  private async summarize(name: QueueName): Promise<QueueSummary> {
    const queue = this.queues[name];
    const [counts, repeatables, paused] = await Promise.all([
      queue.getJobCounts(...COUNTED),
      queue.getRepeatableJobs(),
      queue.isPaused(),
    ]);
    return {
      name,
      counts: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      },
      repeatables: repeatables.map(toRepeatable),
      paused,
    };
  }

  private async job(queue: string, id: string): Promise<Job> {
    const job = await this.queueOf(queue).getJob(id).catch((e) => {
      throw unreachable(e);
    });
    // Also what an expired one looks like: the retention drops the oldest
    // failures, and a page left open still holds their ids.
    if (!job) throw new CodedException('errors.jobs.notFound', HttpStatus.NOT_FOUND, { id });
    return job;
  }

  private queueOf(name: string): Queue {
    return this.queues[assertQueueName(name)];
  }
}

function assertQueueName(name: string): QueueName {
  if (!isQueueName(name)) {
    throw new CodedException('errors.jobs.unknownQueue', HttpStatus.NOT_FOUND, { name });
  }
  return name;
}

/** What a job the queue can no longer place looks like — see `status`. */
function absent(queue: QueueName, id: string): JobStatus {
  return {
    queue,
    id,
    name: '',
    state: 'unknown',
    progress: null,
    error: null,
    warnings: [],
    finishedAt: null,
  };
}

/** BullMQ's state, narrowed to the ones a caller following a job can act on. */
function toJobState(state: string): JobState {
  return (JOB_STATES as readonly string[]).includes(state) ? (state as JobState) : 'waiting';
}

/** Shapes one failed job for the page — see JobFailure. */
export function toFailure(queue: QueueName, job: Job): JobFailure {
  return {
    queue,
    id: String(job.id),
    name: job.name,
    attemptsMade: job.attemptsMade,
    reason: job.failedReason ?? '',
    // BullMQ keeps one entry per attempt; the last is the one that gave up.
    stack: job.stacktrace?.[job.stacktrace.length - 1] ?? null,
    failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    enqueuedAt: new Date(job.timestamp).toISOString(),
    data: (job.data ?? {}) as Record<string, unknown>,
  };
}

/** A repeatable as BullMQ describes it: a pattern, and when it next fires. */
function toRepeatable(job: {
  name: string;
  pattern?: string | null;
  next?: number | null;
}): RepeatableJobPublic {
  return {
    name: job.name,
    pattern: job.pattern ?? '',
    nextRunAt: job.next ? new Date(job.next).toISOString() : null,
  };
}

/** Shapes one in-flight job for the page — see JobRunning. */
export function toRunning(queue: QueueName, state: JobRunning['state'], job: Job): JobRunning {
  const delay = typeof job.delay === 'number' ? job.delay : 0;
  return {
    queue,
    id: String(job.id),
    name: job.name,
    state,
    startedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    enqueuedAt: new Date(job.timestamp).toISOString(),
    // BullMQ stores the delay, not the due date; the due date is what a reader
    // waiting on it actually wants.
    scheduledFor:
      state === 'delayed' && delay > 0 ? new Date(job.timestamp + delay).toISOString() : null,
    // Typed as unknown by BullMQ: anything a job cared to report. Only a number
    // means anything to a caller drawing a bar.
    progress: typeof job.progress === 'number' ? job.progress : null,
    attemptsMade: job.attemptsMade,
    data: (job.data ?? {}) as Record<string, unknown>,
  };
}

/** Running before queued, and within a state the one waiting longest first. */
function byInFlight(a: JobRunning, b: JobRunning): number {
  const rank = IN_FLIGHT_ORDER[a.state] - IN_FLIGHT_ORDER[b.state];
  if (rank !== 0) return rank;
  const left = a.startedAt ?? a.enqueuedAt;
  const right = b.startedAt ?? b.enqueuedAt;
  return left === right ? 0 : left < right ? -1 : 1;
}

const IN_FLIGHT_ORDER: Record<JobRunning['state'], number> = { active: 0, waiting: 1, delayed: 2 };

/** Shapes one completed-but-degraded run — see JobWarning. */
export function toWarning(queue: QueueName, job: Job): JobWarning {
  const returned = job.returnvalue as { warnings?: CodedMessage[] } | null;
  return {
    queue,
    id: String(job.id),
    name: job.name,
    finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    data: (job.data ?? {}) as Record<string, unknown>,
    warnings: returned?.warnings ?? [],
  };
}

/** Newest first, and the ones BullMQ dates last — an undated run is not fresher. */
function byEndedDesc(
  a: { failedAt?: string | null; finishedAt?: string | null },
  b: { failedAt?: string | null; finishedAt?: string | null },
): number {
  const left = a.failedAt ?? a.finishedAt ?? null;
  const right = b.failedAt ?? b.finishedAt ?? null;
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left < right ? 1 : -1;
}

function isQueueName(value: string): value is QueueName {
  return (QUEUE_NAMES as readonly string[]).includes(value);
}

function unreachable(e: unknown): CodedException {
  return new CodedException('errors.jobs.unreachable', HttpStatus.SERVICE_UNAVAILABLE, {
    error: asMessage(e),
  });
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
