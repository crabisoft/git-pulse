import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { DORA_WINDOW_PRESETS } from '@repo/shared';
import { windowLabel, windowOptions } from './doraWindow';

/** Echoes the key, so an assertion names the key rather than the wording. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${params.count}` : key) as unknown as TFunction;

describe('windowLabel', () => {
  it('gives a preset its own wording', () => {
    expect(windowLabel(t, 30)).toBe('dora.window.30');
  });

  it('still words the two years the presets no longer offer', () => {
    // Stored before it was dropped, and still selectable — see windowOptions.
    expect(windowLabel(t, 730)).toBe('dora.window.730');
  });

  it('falls back to a plain day count for anything else', () => {
    // A window stored before the presets existed still has to read as something.
    expect(windowLabel(t, 45)).toBe('dora.window.days:45');
  });
});

describe('windowOptions', () => {
  it('offers the presets, in order', () => {
    expect(windowOptions(30)).toEqual([...DORA_WINDOW_PRESETS]);
  });

  it('adds a stored window that is not a preset, in its place', () => {
    // Dropping it would rewrite the setting on the first save.
    expect(windowOptions(45)).toEqual([7, 15, 30, 45, 60, 90, 180, 365]);
  });

  it('keeps offering a window stored at two years', () => {
    // The install that had it configured before the preset was dropped.
    expect(windowOptions(730)).toEqual([7, 15, 30, 60, 90, 180, 365, 730]);
  });

  it('offers the presets alone when no window is known yet', () => {
    expect(windowOptions(null)).toEqual([...DORA_WINDOW_PRESETS]);
  });
});
