import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CoverageSpan, SourceCoverage } from '@repo/shared';
import { CoverageLine, deepest } from './CoverageLine';

const EMPTY: CoverageSpan = { from: null, to: null, days: null, count: 0 };

function span(days: number, count = 10): CoverageSpan {
  return { from: '2026-06-15T09:00:00.000Z', to: '2026-08-01T08:00:00.000Z', days, count };
}

function coverage(over: Partial<SourceCoverage> = {}): SourceCoverage {
  return {
    sourceId: 'src-1',
    mode: 'stored',
    depthDays: 60,
    retainedDays: 67,
    deployments: span(47),
    pullRequests: span(31),
    pipelines: span(47),
    metrics: span(12),
    ...over,
  };
}

describe('CoverageLine', () => {
  it('states what is held next to what was asked for', () => {
    render(<CoverageLine coverage={coverage()} />);

    expect(screen.getByText('sources.coverage.depth:{"days":60}')).toBeInTheDocument();
    expect(screen.getByText('sources.coverage.store:{"days":47}')).toBeInTheDocument();
    expect(screen.getByText('sources.coverage.metrics:{"days":12}')).toBeInTheDocument();
  });

  it('marks a store shallower than the depth it claims', () => {
    const { container } = render(<CoverageLine coverage={coverage({ depthDays: 365 })} />);

    // The case the line exists for: a source configured for a year that has
    // been collecting for six weeks.
    expect(container.querySelector('.short')).toBeInTheDocument();
  });

  it('leaves a store that reaches its depth unmarked', () => {
    const { container } = render(<CoverageLine coverage={coverage({ depthDays: 30 })} />);

    expect(container.querySelector('.short')).not.toBeInTheDocument();
  });

  it('says a live source has no depth rather than showing none', () => {
    render(
      <CoverageLine
        coverage={coverage({
          mode: 'live',
          depthDays: null,
          retainedDays: null,
          deployments: EMPTY,
          pullRequests: EMPTY,
          pipelines: EMPTY,
        })}
      />,
    );

    expect(screen.queryByText(/sources\.coverage\.depth/)).not.toBeInTheDocument();
    expect(screen.getByText('sources.coverage.storeEmpty')).toBeInTheDocument();
    // Its readings are historized all the same, and that is the one figure a
    // live source does have.
    expect(screen.getByText('sources.coverage.metrics:{"days":12}')).toBeInTheDocument();
  });

  it('reports a source that has never been collected as empty', () => {
    render(
      <CoverageLine
        coverage={coverage({
          deployments: EMPTY,
          pullRequests: EMPTY,
          pipelines: EMPTY,
          metrics: EMPTY,
        })}
      />,
    );

    expect(screen.getByText('sources.coverage.storeEmpty')).toBeInTheDocument();
    expect(screen.getByText('sources.coverage.metricsEmpty')).toBeInTheDocument();
  });
});

describe('deepest', () => {
  it('takes the deepest table, not the shallowest', () => {
    // The tables are not filled in step: a source deploying weekly holds fewer
    // deployments than pipelines over the same weeks, and reading the smallest
    // as "the history" would understate every install.
    expect(deepest(coverage({ pullRequests: span(3) }))).toBe(47);
  });

  it('ignores the tables that hold nothing', () => {
    expect(deepest(coverage({ deployments: EMPTY, pipelines: EMPTY }))).toBe(31);
  });

  it('has no depth to report when nothing is stored', () => {
    expect(
      deepest(coverage({ deployments: EMPTY, pullRequests: EMPTY, pipelines: EMPTY })),
    ).toBeNull();
  });
});
