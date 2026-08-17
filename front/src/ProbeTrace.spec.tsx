import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { VersionProbeAttempt, VersionProbeTrace } from '@repo/shared';
import { ProbeTrace } from './ProbeTrace';

function attempt(over: Partial<VersionProbeAttempt> = {}): VersionProbeAttempt {
  return {
    ruleId: 'vr-1',
    rule: 'Actuator',
    url: 'https://api.example.com/actuator/info',
    httpStatus: 200,
    status: 'ok',
    version: '1.4.2',
    error: null,
    tookMs: 41,
    filed: true,
    ...over,
  };
}

function trace(over: Partial<VersionProbeTrace> = {}): VersionProbeTrace {
  return { repo: 'acme/api', environment: 'prod', attempts: [attempt()], ...over };
}

describe('ProbeTrace', () => {
  it('names every address tried, in the order they were tried', () => {
    render(
      <ProbeTrace
        trace={[
          trace({
            attempts: [
              attempt({
                ruleId: 'vr-1',
                url: 'https://api.example.com/actuator/info',
                httpStatus: 404,
                status: 'unreachable',
                version: null,
                error: { code: 'errors.version.httpStatus', params: { status: 404 } },
                filed: false,
              }),
              attempt({ ruleId: 'vr-2', rule: 'version.json' }),
            ],
          }),
        ]}
      />,
    );

    const addresses = screen.getAllByText(/api\.example\.com/).map((node) => node.textContent);
    expect(addresses).toEqual([
      'https://api.example.com/actuator/info',
      'https://api.example.com/actuator/info',
    ]);
    expect(screen.getByText('errors.version.httpStatus:{"status":404}')).toBeInTheDocument();
    expect(screen.getByText('1.4.2')).toBeInTheDocument();
  });

  it('marks the attempt that became the reading, and only that one', () => {
    const { container } = render(
      <ProbeTrace
        trace={[
          trace({
            attempts: [
              attempt({ ruleId: 'vr-1', filed: false, status: 'unreachable', version: null }),
              attempt({ ruleId: 'vr-2', filed: true }),
            ],
          }),
        ]}
      />,
    );

    // The walk keeps whichever attempt got furthest when nothing answered, so
    // the marker cannot be inferred from the order.
    expect(container.querySelectorAll('.probe-trace-attempt.filed')).toHaveLength(1);
    expect(screen.getAllByText('sources.probe.trace.filed')).toHaveLength(1);
  });

  it('says a rule could not be addressed rather than showing a hole', () => {
    render(
      <ProbeTrace
        trace={[
          trace({
            attempts: [
              attempt({
                url: null,
                httpStatus: null,
                status: 'skipped',
                version: null,
                tookMs: 0,
                error: { code: 'errors.version.noAttribute', params: { key: 'client' } },
              }),
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByText('sources.probe.trace.noAddress')).toBeInTheDocument();
    // No response arrived, so the status column names the outcome instead of a
    // number that would suggest a server answered.
    expect(screen.getByText('versions.status.skipped')).toBeInTheDocument();
    expect(screen.getByText('errors.version.noAttribute:{"key":"client"}')).toBeInTheDocument();
  });

  it('reports an environment no rule claims, rather than leaving it blank', () => {
    render(<ProbeTrace trace={[trace({ attempts: [] })]} />);

    expect(screen.getByText('sources.probe.trace.noRule')).toBeInTheDocument();
  });

  it('names a declared environment on its own, having no repo', () => {
    render(<ProbeTrace trace={[trace({ repo: '', environment: 'contoso-appliance' })]} />);

    expect(screen.getByText('contoso-appliance')).toBeInTheDocument();
  });

  it('shows nothing when the API sent no walk at all', () => {
    // An API a version behind the bundle sends an outcome without one. Nothing
    // renders above this to catch a throw, so reading the length of what is not
    // there would blank the page rather than the panel.
    const { container } = render(
      <ProbeTrace trace={undefined as unknown as VersionProbeTrace[]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing at all when no environment was walked', () => {
    // A run that failed before reaching any address — or one the API refused —
    // has no walk to describe, and an empty disclosure would invite a click
    // that answers nothing.
    const { container } = render(<ProbeTrace trace={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
