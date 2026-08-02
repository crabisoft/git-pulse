import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { EnvUrlsModule } from './env-urls.module';
import { EnvUrlsService } from './env-urls.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DeploymentsModule } from '../deployments/deployments.module';
import { VersionRulesModule } from '../version-rules/version-rules.module';

/**
 * Three modules now decide where an environment answers, and each injects this
 * one to do it. A module that injects a service without importing the module
 * that exports it fails at boot rather than at build: the constructor is
 * satisfied by the type, the type is there, and the compiler has no opinion.
 *
 * The dashboard is the live example. It reads its own deployments rather than
 * going through the deployments service, so it needed the address book on its
 * own — and it typechecked perfectly without importing anything.
 *
 * Checked against the decorator metadata rather than by standing the container
 * up, exactly as `VersionRulesModule` does: compiling the real graph would open
 * a Redis connection and a database one to assert a list.
 */
const READERS: ReadonlyArray<[object, string]> = [
  [DeploymentsModule, 'DeploymentsModule'],
  [DashboardModule, 'DashboardModule'],
  [VersionRulesModule, 'VersionRulesModule'],
];

describe('EnvUrlsModule', () => {
  it('is imported by every module that settles an address', () => {
    for (const [module, name] of READERS) {
      const imports = (Reflect.getMetadata('imports', module) ?? []) as unknown[];
      expect(imports, name).toContain(EnvUrlsModule);
    }
  });

  it('exports the service they inject', () => {
    const exported = (Reflect.getMetadata('exports', EnvUrlsModule) ?? []) as unknown[];
    expect(exported).toContain(EnvUrlsService);
  });
});
