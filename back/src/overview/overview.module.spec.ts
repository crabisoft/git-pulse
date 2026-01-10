import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { OverviewModule } from './overview.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DashboardService } from '../dashboard/dashboard.service';
import { DoraModule } from '../dora/dora.module';
import { DoraService } from '../dora/dora.service';
import { CollectionModule } from '../collection/collection.module';
import { CollectorService } from '../collection/collector.service';
import { JobsModule } from '../jobs/jobs.module';
import { JobsService } from '../jobs/jobs.service';
import { ApiQuotaModule } from '../api-quota/api-quota.module';
import { ApiQuotaService } from '../api-quota/api-quota.service';

/**
 * The overview injects services five other modules own, and a module that
 * provides one without exporting it fails at boot rather than at build — the
 * kind of break nothing in the source looks wrong for.
 *
 * Checked against the decorator metadata rather than by standing the container
 * up: compiling the real graph would open a Redis connection and a database
 * one, which is a lot of machinery to assert a list.
 */
const NEEDED: ReadonlyArray<[object, object, string]> = [
  [DashboardModule, DashboardService, 'DashboardService'],
  [DoraModule, DoraService, 'DoraService'],
  [CollectionModule, CollectorService, 'CollectorService'],
  [JobsModule, JobsService, 'JobsService'],
  [ApiQuotaModule, ApiQuotaService, 'ApiQuotaService'],
];

/** SettingsService and PrismaService come from global modules — nothing to import. */
describe('OverviewModule', () => {
  it('imports every module it reads a service from', () => {
    const imports = (Reflect.getMetadata('imports', OverviewModule) ?? []) as unknown[];
    for (const [module, , name] of NEEDED) {
      expect(imports, name).toContain(module);
    }
  });

  it('is handed the services it injects', () => {
    for (const [module, service, name] of NEEDED) {
      const exported = (Reflect.getMetadata('exports', module) ?? []) as unknown[];
      expect(exported, name).toContain(service);
    }
  });
});
