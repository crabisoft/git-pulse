import { describe, expect, it } from 'vitest';
import { probe } from './version-probe';

/**
 * What can be asserted without a socket: every refusal a probe makes before it
 * opens one. The rest — the timeout, the size cap, the unfollowed redirect —
 * needs a server on a reachable address, and a reachable address is precisely
 * what this module refuses to have in a test. The address ranges themselves are
 * covered exhaustively in `private-address.spec.ts`, which is where the risk of
 * this feature actually lives.
 */
describe('probe, before it connects', () => {
  it('refuses a URL it cannot read', async () => {
    expect(await probe({ url: 'not a url' })).toMatchObject({
      ok: false,
      reason: { code: 'errors.version.invalidUrl' },
    });
  });

  it('refuses a scheme that is not http', async () => {
    // `file:` would read the container this process runs in.
    expect(await probe({ url: 'file:///etc/passwd' })).toMatchObject({
      ok: false,
      reason: { code: 'errors.version.unsupportedScheme', params: { scheme: 'file' } },
    });
    expect(await probe({ url: 'ftp://example.com/version' })).toMatchObject({
      reason: { code: 'errors.version.unsupportedScheme' },
    });
  });

  it('refuses an address written straight into the URL', async () => {
    // The shortest way past a guard that only runs when a name is resolved.
    for (const url of [
      'http://127.0.0.1:5432/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/version',
      'http://[::1]:8080/version',
    ]) {
      expect(await probe({ url }), url).toMatchObject({
        ok: false,
        reason: { code: 'errors.version.forbiddenAddress' },
      });
    }
  });

  it('does not refuse a public address written straight into the URL', async () => {
    // It fails later, on the network — what matters is that it was not refused
    // out of hand for being an address.
    const result = await probe({ url: 'http://93.184.216.34/version', timeoutMs: 1 });
    expect(result.reason?.code).not.toBe('errors.version.forbiddenAddress');
  });

  it('reports a name that resolves to nothing it may reach', async () => {
    // `localtest.me` is a public name whose owner points it at 127.0.0.1 — the
    // reason the check is on the resolved address and not on the hostname.
    const result = await probe({ url: 'http://localtest.me/version', timeoutMs: 2_000 });
    expect(result.ok).toBe(false);
    expect(result.reason?.code).toBe('errors.version.unreachable');
    // Tolerant of a runner with no DNS at all: what is being asserted is that
    // nothing was ever connected to, and a name that resolves to nothing at all
    // satisfies that too.
    expect(String(result.reason?.params?.detail)).toMatch(
      /no address a probe may reach|ENOTFOUND|EAI_AGAIN/,
    );
  });
});
