import { describe, expect, it } from 'vitest';
import type { TicketRef } from '@repo/shared';
import { linkTickets } from './link-tickets';

function ticket(key: string, url?: string): TicketRef {
  return {
    key,
    ...(url ? { url } : {}),
    foundIn: 'title',
    tracker: { id: 'tr-1', name: 'Jira', kind: 'jira' },
  };
}

const OPS = ticket('OPS-123', 'https://jira.example.com/browse/OPS-123');

describe('linkTickets', () => {
  it('links a key the rules recognised', () => {
    // The convention's writer links `#42` to this repository and nothing else,
    // so a tracker key comes out of it as plain text.
    const out = linkTickets('* **auth:** reset a password, OPS-123', [OPS]);
    expect(out).toBe(
      '* **auth:** reset a password, [OPS-123](https://jira.example.com/browse/OPS-123)',
    );
  });

  it('links every occurrence of it', () => {
    const out = linkTickets('OPS-123 fixed. See OPS-123.', [OPS]);
    expect(out.match(/\[OPS-123\]/g)).toHaveLength(2);
  });

  it('leaves a key that resolved to no URL as it was', () => {
    // A git-hosted tracker with no repo to build against, typically. A link to
    // nowhere is worse than the text somebody wrote.
    expect(linkTickets('closes OPS-9', [ticket('OPS-9')])).toBe('closes OPS-9');
  });

  it('does not link a key that is already a link', () => {
    // Nesting one link inside another produces markup no renderer agrees on.
    const already = '[OPS-123](https://jira.example.com/browse/OPS-123)';
    expect(linkTickets(`fixes ${already}`, [OPS])).toBe(`fixes ${already}`);
  });

  it('leaves inline code alone', () => {
    // A key inside a backtick run is being quoted, not referenced.
    expect(linkTickets('rename `OPS-123` to something', [OPS])).toBe(
      'rename `OPS-123` to something',
    );
  });

  it('does not let a shorter key eat a longer one', () => {
    const short = ticket('OPS-1', 'https://jira.example.com/browse/OPS-1');
    const long = ticket('OPS-12', 'https://jira.example.com/browse/OPS-12');
    const out = linkTickets('OPS-12 and OPS-1', [short, long]);
    expect(out).toBe(
      '[OPS-12](https://jira.example.com/browse/OPS-12) and ' +
        '[OPS-1](https://jira.example.com/browse/OPS-1)',
    );
  });

  it('does not match a key that is only the start of a longer word', () => {
    // `OPS-12` is not a mention of `OPS-1`, and neither is `OPS-1x`.
    const short = ticket('OPS-1', 'https://jira.example.com/browse/OPS-1');
    expect(linkTickets('see OPS-12 and OPS-1x', [short])).toBe('see OPS-12 and OPS-1x');
  });

  it('keeps the first URL a key was given', () => {
    // The extraction already applied the rules in priority order; two entries
    // carrying the same key carry the same decision.
    const first = ticket('OPS-5', 'https://jira.example.com/browse/OPS-5');
    const second = ticket('OPS-5', 'https://elsewhere.example.com/OPS-5');
    expect(linkTickets('OPS-5', [first, second])).toContain('jira.example.com');
  });

  it('hands back a changelog nothing was found in', () => {
    expect(linkTickets('* **auth:** reset a password', [])).toBe('* **auth:** reset a password');
  });

  it('survives a key holding regex punctuation', () => {
    const odd = ticket('#42', 'https://github.example.com/acme/widget/issues/42');
    expect(linkTickets('closes #42', [odd])).toBe(
      'closes [#42](https://github.example.com/acme/widget/issues/42)',
    );
  });
});
