import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PAGE_LIMIT_MAX, type Page } from '@repo/shared';

/** Optional page size query param, rejected beyond PAGE_LIMIT_MAX. */
export const IsLimit = () =>
  applyDecorators(IsOptional(), Type(() => Number), IsInt(), Min(1), Max(PAGE_LIMIT_MAX));

/** Optional page offset query param. */
export const IsOffset = () =>
  applyDecorators(IsOptional(), Type(() => Number), IsInt(), Min(0));

/** limit/offset accepted by every list route. */
export class PaginationQueryDto {
  @IsLimit()
  limit?: number;

  @IsOffset()
  offset?: number;
}

/** A resolved window, defaults applied. */
export interface PageWindow {
  limit: number;
  offset: number;
}

/**
 * Turns a (possibly empty) query into a concrete window. `defaultLimit` is the
 * configured page size (`AppSettings.pageSize`) and is required so no list route
 * can silently fall back to a hard-coded value.
 */
export function toWindow(
  query: { limit?: number; offset?: number } | undefined,
  defaultLimit: number,
): PageWindow {
  return {
    limit: query?.limit ?? defaultLimit,
    offset: query?.offset ?? 0,
  };
}

/** Wraps an already-windowed slice with its page metadata. */
export function toPage<T>(items: T[], total: number, window: PageWindow): Page<T> {
  return {
    items,
    page: {
      total,
      limit: window.limit,
      offset: window.offset,
      hasMore: window.offset + items.length < total,
    },
  };
}

/** Applies a window to a list already held in memory. */
export function paginate<T>(all: T[], window: PageWindow): Page<T> {
  return toPage(all.slice(window.offset, window.offset + window.limit), all.length, window);
}
