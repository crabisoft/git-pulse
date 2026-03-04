import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MetricSeriesDto } from './metric-series.dto';

function parse(payload: unknown): MetricSeriesDto {
  return plainToInstance(MetricSeriesDto, payload);
}

function reject(payload: unknown): string[] {
  return validateSync(parse(payload) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((e) => e.property);
}

describe('MetricSeriesDto', () => {
  it('takes a rolling window, as the DORA endpoint does', () => {
    // The common case by far: a period picked from the presets sets no bounds
    // at all, so without this the chart had nothing to be narrowed by.
    expect(reject({ metric: 'lead_time', windowDays: 90 })).toEqual([]);
    expect(parse({ metric: 'lead_time', windowDays: '90' }).windowDays).toBe(90);
  });

  it('holds a window to the same bounds a window may take anywhere else', () => {
    expect(reject({ metric: 'lead_time', windowDays: 731 })).toEqual(['windowDays']);
    expect(reject({ metric: 'lead_time', windowDays: 0 })).toEqual(['windowDays']);
  });

  it('still accepts explicit bounds, which take precedence over a window', () => {
    expect(reject({ metric: 'lead_time', from: '2026-01-01', to: '2026-01-31' })).toEqual([]);
  });

  it('rejects a bound that is not a date', () => {
    expect(reject({ metric: 'lead_time', from: 'last monday' })).toEqual(['from']);
  });
});
