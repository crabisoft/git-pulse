import { describe, expect, it } from 'vitest';
import { initials, nameHue } from './initials';

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Jacques Raphanel')).toBe('JR');
  });

  it('stops at two, however many words a name has', () => {
    // Three letters stop reading as a monogram and start reading as a word.
    expect(initials('Ana María López Ortiz')).toBe('AM');
  });

  it('gives a single word its first letter alone', () => {
    // Padding it with the second letter would read as two words that are not
    // there — "Ad" for Ada looks like a surname nobody wrote.
    expect(initials('Ada')).toBe('A');
  });

  it('reads a hyphen and an apostrophe as word breaks', () => {
    expect(initials('Jean-Luc Picard')).toBe('JL');
    expect(initials("N'Diaye")).toBe('ND');
  });

  it('keeps the accent on a letter that carries one', () => {
    expect(initials('Élodie Ferrand')).toBe('ÉF');
  });

  it('uppercases what was written lower', () => {
    expect(initials('ada lovelace')).toBe('AL');
  });

  it('ignores what is not a letter', () => {
    // A dot abbreviates rather than divides, and a decoration contributes
    // nothing — two accounts differing only by a bracket must not collide.
    expect(initials('J. R. R. Tolkien')).toBe('JR');
    expect(initials('★ Nova Chen')).toBe('NC');
  });

  it('gives nothing for a name with no letter in it', () => {
    // Honest: the avatar shows an empty disc rather than a placeholder glyph
    // that would look like a name we failed to read.
    expect(initials('   ')).toBe('');
    expect(initials('42')).toBe('');
  });

  it('reads a name written in another script', () => {
    expect(initials('Мария Иванова')).toBe('МИ');
  });
});

describe('nameHue', () => {
  it('gives the same name the same hue, every time', () => {
    // The whole reason it is derived rather than stored: one person is one
    // colour on every screen of the install, with nothing written down.
    expect(nameHue('Jacques Raphanel')).toBe(nameHue('Jacques Raphanel'));
  });

  it('stays on the wheel', () => {
    for (const name of ['A', 'Ada Lovelace', 'Мария', '', '★']) {
      const hue = nameHue(name);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('separates names that look alike', () => {
    expect(nameHue('Ada Lovelace')).not.toBe(nameHue('Ada Lovelock'));
  });
});
