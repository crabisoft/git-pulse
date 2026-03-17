import type { Meta, StoryObj } from '@storybook/react-vite';
import { doraTier, type DoraMetric } from '@repo/shared';
import { Gauge } from './Gauge';

/**
 * A metric read as a position rather than as a number: the four DORA bands
 * behind a marker, the occupied one saturated and the rest held back.
 *
 * **This is where the direction switch above earns its place.** The band ramp
 * — clay through to teal — is declared by `:root[data-direction="instrument"]`
 * and by nothing else. These stories therefore pin that direction — the only
 * one the application ever draws a gauge in — through a parameter rather than
 * a global: a docs page renders every story of a component into one document,
 * and a global would be one attribute on one root element for all of them,
 * with the last to mount deciding for its siblings. Outside `instrument` the
 * bands simply have no ramp and the marker is left on its own, which is why
 * the instrument view is the only view that draws a gauge.
 *
 * The tier is computed by the shared engine rather than passed by hand, so a
 * story cannot claim a band the thresholds disagree with.
 */
function AtValue({ metric, tierValue }: { metric: DoraMetric; tierValue: number }) {
  const tier = doraTier(metric, tierValue);
  if (!tier) return <p className="muted">No published scale for {metric}.</p>;
  return <Gauge metric={metric} tierValue={tierValue} tier={tier} />;
}

const meta = {
  title: 'Controls/Gauge',
  component: AtValue,
  args: { metric: 'lead_time', tierValue: 97_200 },
  // The instrument panel is the only view that renders a gauge, and the only
  // direction that declares the ramp it is drawn from. Read by the decorator
  // in `.storybook/preview.tsx`.
  parameters: { layout: 'centered', direction: 'instrument' },
} satisfies Meta<typeof AtValue>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A day and a half to production: past the hour that reads as elite. */
export const LeadTime: Story = {};

/** Under an hour, and the marker sits in the last band. */
export const Elite: Story = { args: { metric: 'lead_time', tierValue: 1_800 } };

/** Over a month. The worst band is the widest, deliberately. */
export const Low: Story = { args: { metric: 'lead_time', tierValue: 3_600_000 } };

/** More is better here, and the ramp reads the other way round. */
export const DeploymentFrequency: Story = {
  args: { metric: 'deployment_frequency', tierValue: 2.4 },
};

export const FailureRate: Story = {
  args: { metric: 'change_failure_rate', tierValue: 0.11 },
};

/**
 * The breakdown metrics have no published scale, and inventing one would dress
 * a guess as a standard — so nothing is drawn at all.
 */
export const NoPublishedScale: Story = {
  args: { metric: 'coding_time', tierValue: 28_800 },
};
