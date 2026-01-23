import { Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { FailuresQueryDto } from './dto/failures-query.dto';
import { SettingsService } from '../settings/settings.service';
import { toWindow } from '../common/pagination';

/**
 * The background queues, read and acted on.
 *
 * Nothing here is decorated, so everything is admin — the default of every
 * route that says nothing. That is the level it belongs at: a failure carries
 * the payload it was working on and the message a platform answered with, which
 * is more than a viewer of the dashboard is shown anywhere else.
 */
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
  ) {}

  /** Counts, schedules and reachability of every queue, at the instant. */
  @Get()
  snapshot() {
    return this.jobs.snapshot();
  }

  /** Failed jobs, newest first, merged across the queues unless one is named. */
  @Get('failures')
  async failures(@Query() query: FailuresQueryDto) {
    return this.jobs.failures(query.queue, toWindow(query, await this.settings.pageSize()));
  }

  /** Runs that completed having given up on part of their work. */
  @Get('degraded')
  async degraded(@Query() query: FailuresQueryDto) {
    return this.jobs.degraded(query.queue, toWindow(query, await this.settings.pageSize()));
  }

  /**
   * One job, for whoever started it and wants to know where it got to.
   *
   * Admin like the rest of this controller — it is reached from the sources
   * page, which is admin already, and it carries what a run gave up on.
   */
  @Get(':queue/:id')
  status(@Param('queue') queue: string, @Param('id') id: string) {
    return this.jobs.status(queue, id);
  }

  @Post(':queue/:id/retry')
  @HttpCode(204)
  async retry(@Param('queue') queue: string, @Param('id') id: string): Promise<void> {
    await this.jobs.retry(queue, id);
  }

  @Delete(':queue/:id')
  @HttpCode(204)
  async discard(@Param('queue') queue: string, @Param('id') id: string): Promise<void> {
    await this.jobs.discard(queue, id);
  }
}
