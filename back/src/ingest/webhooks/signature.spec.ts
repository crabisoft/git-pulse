import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verify, type HeaderBag } from './signature';

const SECRET = 'un-secret-partagé';
const BODY = Buffer.from(JSON.stringify({ action: 'opened', number: 42 }));

function signed(body: Buffer = BODY, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function githubHeaders(over: HeaderBag = {}): HeaderBag {
  return {
    'x-github-event': 'pull_request',
    'x-github-delivery': 'd-1',
    'x-hub-signature-256': signed(),
    ...over,
  };
}

function gitlabHeaders(over: HeaderBag = {}): HeaderBag {
  return {
    'x-gitlab-event': 'Merge Request Hook',
    'x-gitlab-event-uuid': 'u-1',
    'x-gitlab-token': SECRET,
    ...over,
  };
}

describe('verify — GitHub', () => {
  it('accepts a body signed with the stored secret', () => {
    expect(verify('github', githubHeaders(), BODY, SECRET)).toEqual({
      ok: true,
      deliveryId: 'd-1',
      event: 'pull_request',
    });
  });

  it('refuses a signature computed with another secret', () => {
    const headers = githubHeaders({ 'x-hub-signature-256': signed(BODY, 'autre-secret') });
    expect(verify('github', headers, BODY, SECRET)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a body altered after signing', () => {
    // The whole point of signing the body rather than sending the secret: the
    // signature stays valid-looking, the payload does not match it.
    const tampered = Buffer.from(JSON.stringify({ action: 'opened', number: 43 }));
    expect(verify('github', githubHeaders(), tampered, SECRET)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('refuses an unsigned delivery', () => {
    const headers = githubHeaders({ 'x-hub-signature-256': undefined });
    expect(verify('github', headers, BODY, SECRET)).toEqual({ ok: false, reason: 'unsigned' });
  });

  it('refuses a delivery naming no event', () => {
    const headers = githubHeaders({ 'x-github-event': undefined });
    expect(verify('github', headers, BODY, SECRET)).toEqual({ ok: false, reason: 'no-event' });
  });

  it('falls back to the digest when no delivery id was sent', () => {
    const verdict = verify('github', githubHeaders({ 'x-github-delivery': undefined }), BODY, SECRET);
    // Any stable value will do; what matters is that deduplication keeps working.
    expect(verdict).toMatchObject({ ok: true, deliveryId: signed() });
  });
});

describe('verify — GitLab', () => {
  it('accepts the stored token', () => {
    expect(verify('gitlab', gitlabHeaders(), BODY, SECRET)).toEqual({
      ok: true,
      deliveryId: 'u-1',
      event: 'Merge Request Hook',
    });
  });

  it('refuses another token', () => {
    const headers = gitlabHeaders({ 'x-gitlab-token': 'autre-secret' });
    expect(verify('gitlab', headers, BODY, SECRET)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a token of the right value but wrong length', () => {
    const headers = gitlabHeaders({ 'x-gitlab-token': `${SECRET} ` });
    expect(verify('gitlab', headers, BODY, SECRET)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a delivery carrying no token', () => {
    const headers = gitlabHeaders({ 'x-gitlab-token': undefined });
    expect(verify('gitlab', headers, BODY, SECRET)).toEqual({ ok: false, reason: 'unsigned' });
  });
});
