import type { Meta, StoryObj } from '@storybook/react-vite';
import type { VersionProbeAttempt } from '@repo/shared';
import { ProbeTrace } from './ProbeTrace';

/**
 * Where a probing run went, under the sentence saying what it did.
 *
 * The states worth looking at are the ones that disappoint: an address passed
 * over, a rule that could not be addressed at all, an environment nothing
 * claims. A run that worked is here too, and it is the least interesting of
 * them — which is exactly why the panel is folded away by default.
 */
function attempt(over: Partial<VersionProbeAttempt> = {}): VersionProbeAttempt {
  return {
    ruleId: 'vr-1',
    rule: 'Actuator',
    url: 'https://api.acme.example.com/actuator/info',
    httpStatus: 200,
    status: 'ok',
    version: '1.4.2',
    error: null,
    tookMs: 41,
    filed: true,
    ...over,
  };
}

const meta = {
  title: 'Controls/ProbeTrace',
  component: ProbeTrace,
  args: {
    trace: [{ repo: 'acme/api', environment: 'prod', attempts: [attempt()] }],
  },
} satisfies Meta<typeof ProbeTrace>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One rule, one address, a version read. Nothing to diagnose. */
export const Read: Story = {};

/** The walk the feature exists for: the first address is not the one. */
export const SecondAddressAnswered: Story = {
  args: {
    trace: [
      {
        repo: 'acme/api',
        environment: 'prod',
        attempts: [
          attempt({
            ruleId: 'vr-1',
            httpStatus: 404,
            status: 'unreachable',
            version: null,
            error: { code: 'errors.version.httpStatus', params: { status: 404 } },
            tookMs: 83,
            filed: false,
          }),
          attempt({
            ruleId: 'vr-2',
            rule: 'version.json',
            url: 'https://api.acme.example.com/version.json',
          }),
        ],
      },
    ],
  },
};

/**
 * Nothing answered, so the attempt that got furthest is the one filed — which
 * is not the last one tried, and cannot be read off the order.
 */
export const NothingAnswered: Story = {
  args: {
    trace: [
      {
        repo: 'acme/api',
        environment: 'prod',
        attempts: [
          attempt({
            ruleId: 'vr-1',
            url: null,
            httpStatus: null,
            status: 'skipped',
            version: null,
            tookMs: 0,
            error: { code: 'errors.version.noAttribute', params: { key: 'client' } },
            filed: false,
          }),
          attempt({
            ruleId: 'vr-2',
            rule: 'version.json',
            url: 'https://api.acme.example.com/version.json',
            httpStatus: 200,
            status: 'noMatch',
            version: null,
            error: { code: 'errors.version.pathMissing', params: { path: 'build.version' } },
            tookMs: 37,
            filed: true,
          }),
          attempt({
            ruleId: 'vr-3',
            rule: 'Legacy',
            url: 'https://api.acme.example.com/legacy',
            httpStatus: null,
            status: 'unreachable',
            version: null,
            error: { code: 'errors.version.timeout', params: { timeoutMs: 5000 } },
            tookMs: 5003,
            filed: false,
          }),
        ],
      },
    ],
  },
};

/** Several environments, including one no rule claims and a declared one. */
export const AcrossEnvironments: Story = {
  args: {
    trace: [
      { repo: 'acme/api', environment: 'prod', attempts: [attempt()] },
      { repo: 'acme/portal', environment: 'staging', attempts: [] },
      {
        repo: '',
        environment: 'contoso-appliance',
        attempts: [
          attempt({
            ruleId: 'vr-4',
            rule: 'Appliance',
            url: 'https://contoso.example.com/version',
            version: '1.3.9',
          }),
        ],
      },
    ],
  },
};
