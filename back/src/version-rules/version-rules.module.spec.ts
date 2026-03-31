import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { VersionRulesModule } from './version-rules.module';
import { VersionRulesService } from './version-rules.service';
import { VersionReadingsService } from './version-readings.service';
import { VersionProbeProcessor } from './version-probe.processor';
import { VersionReadingStoreModule } from './version-reading-store.module';
import { VersionReadingStore } from './version-reading.store';
import { CryptoModule } from '../crypto/crypto.module';
import { CredentialsService } from '../crypto/credentials.service';
import { DeploymentsModule } from '../deployments/deployments.module';
import { DeploymentsService } from '../deployments/deployments.service';
import { EnvRulesModule } from '../env-rules/env-rules.module';
import { EnvRulesService } from '../env-rules/env-rules.service';

/**
 * Both modules inject services other modules own, and a module that provides
 * one without exporting it — or imports nothing at all for it — fails at boot
 * rather than at build. Nothing in the source looks wrong for it, and the
 * compiler has no opinion: the constructor is satisfied by the type, and the
 * type is there.
 *
 * The reading store is the live example. It grew a second dependency when it
 * started handing readings out already classified, and that dependency is a
 * service from another module.
 *
 * Checked against the decorator metadata rather than by standing the container
 * up: compiling the real graph would open a Redis connection and a database
 * one, which is a lot of machinery to assert a list.
 */
const RULES_NEEDS: ReadonlyArray<[object, object, string]> = [
  [CryptoModule, CredentialsService, 'CredentialsService'],
  [DeploymentsModule, DeploymentsService, 'DeploymentsService'],
  [VersionReadingStoreModule, VersionReadingStore, 'VersionReadingStore'],
];

const STORE_NEEDS: ReadonlyArray<[object, object, string]> = [
  [EnvRulesModule, EnvRulesService, 'EnvRulesService'],
];

/** SettingsService and PrismaService come from global modules — nothing to import. */
describe('VersionRulesModule', () => {
  it('imports every module it reads a service from', () => {
    const imports = (Reflect.getMetadata('imports', VersionRulesModule) ?? []) as unknown[];
    for (const [module, , name] of RULES_NEEDS) {
      expect(imports, name).toContain(module);
    }
  });

  it('is handed the services it injects', () => {
    for (const [module, service, name] of RULES_NEEDS) {
      const exported = (Reflect.getMetadata('exports', module) ?? []) as unknown[];
      expect(exported, name).toContain(service);
    }
  });

  it('exports what the collection and the overview read it for', () => {
    const exported = (Reflect.getMetadata('exports', VersionRulesModule) ?? []) as unknown[];
    expect(exported).toContain(VersionRulesService);
    expect(exported).toContain(VersionReadingsService);
  });

  /**
   * The queue is consumed here and written to from the ingestion. A worker
   * declared in neither module is a queue that fills and is never read — which
   * looks like an environment nobody probes, three layers away from the cause.
   */
  it('runs the worker for the readings an event asks for', () => {
    const providers = (Reflect.getMetadata('providers', VersionRulesModule) ?? []) as unknown[];
    expect(providers).toContain(VersionProbeProcessor);
  });
});

describe('VersionReadingStoreModule', () => {
  it('imports the rules the store classifies readings with', () => {
    const imports = (Reflect.getMetadata('imports', VersionReadingStoreModule) ?? []) as unknown[];
    for (const [module, , name] of STORE_NEEDS) {
      expect(imports, name).toContain(module);
    }
  });

  it('is handed the services it injects', () => {
    for (const [module, service, name] of STORE_NEEDS) {
      const exported = (Reflect.getMetadata('exports', module) ?? []) as unknown[];
      expect(exported, name).toContain(service);
    }
  });

  /**
   * The split that keeps the dependency running one way: the deployments module
   * and the overview read the table, while the service that writes it needs the
   * deployments module to know what to read. Exporting the store from here is
   * what lets both sides have it without a cycle.
   */
  it('exports the store both readers depend on', () => {
    const exported = (Reflect.getMetadata('exports', VersionReadingStoreModule) ?? []) as unknown[];
    expect(exported).toContain(VersionReadingStore);
  });
});
