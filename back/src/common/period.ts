import { HttpStatus } from '@nestjs/common';
import type { DoraPeriod } from '@repo/shared';
import { CodedException } from './coded-exception';

/** The three ways a caller may ask for a period, all optional. */
export interface PeriodQuery {
  from?: string;
  to?: string;
  windowDays?: number;
}

/**
 * Applies the defaults and rejects an inverted period. Three ways to ask, by
 * decreasing precedence: an explicit `from`, a rolling `windowDays`, and the
 * install's configured window.
 *
 * Shared by every route that reports over a period rather than living here as
 * one endpoint's private rule: two implementations of "what does an omitted
 * `to` mean" would drift, and a period is the one thing every number on screen
 * is relative to.
 */
export function resolvePeriod(query: PeriodQuery, fallbackWindowDays: number): DoraPeriod {
  const to = query.to ? endOfDayIfDateOnly(query.to) : new Date();
  // An explicit `to` with no `from` reads as "the window ending that day".
  let windowDays: number | null = null;
  let from: Date;
  if (query.from) {
    // Not end-of-day like `to`: a lower bound stated as a date means the whole
    // of that day, so it opens at its first millisecond rather than its last.
    from = new Date(query.from);
  } else {
    windowDays = query.windowDays ?? fallbackWindowDays;
    from = new Date(to.getTime() - windowDays * 86_400_000);
  }
  if (from.getTime() > to.getTime()) {
    throw new CodedException('errors.dora.invalidRange', HttpStatus.BAD_REQUEST, {
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }
  return { from: from.toISOString(), to: to.toISOString(), windowDays };
}

/** Whether an ISO instant falls inside a resolved period, both bounds included. */
export function within(at: string, period: DoraPeriod): boolean {
  const ms = new Date(at).getTime();
  return ms >= new Date(period.from).getTime() && ms <= new Date(period.to).getTime();
}

/** A date with no time is the whole day, so it ends at its last millisecond. */
function endOfDayIfDateOnly(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(value);
}
