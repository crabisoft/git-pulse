import { describe, expect, it } from 'vitest';
import { MATRIX_INLINE_COLUMNS, matrixScrollClass } from './parts';

describe('matrixScrollClass', () => {
  it('keeps a grid in the text column while it has few enough columns', () => {
    // Where every heading and card on the page starts. A crossing of three
    // adrift in the gutter is a grid that looks lost, and it gains nothing
    // from room it does not need.
    expect(matrixScrollClass(1)).toBe('matrix-scroll');
    expect(matrixScrollClass(MATRIX_INLINE_COLUMNS)).toBe('matrix-scroll');
  });

  it('gives it the page one column past that', () => {
    // The threshold is on the count, not on a measured width: a grid that moved
    // only once it happened to outgrow the column would move for a reason the
    // reader cannot see.
    expect(matrixScrollClass(MATRIX_INLINE_COLUMNS + 1)).toBe('matrix-scroll wide');
    expect(matrixScrollClass(20)).toBe('matrix-scroll wide');
  });

  it('leaves an empty crossing where it is', () => {
    expect(matrixScrollClass(0)).toBe('matrix-scroll');
  });
});
