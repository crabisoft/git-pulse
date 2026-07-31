import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import type { CodedMessage, VersionAuthKind } from '@repo/shared';
import { isForbiddenAddress } from './private-address';

/** How long a probe waits, and how much of an answer it is willing to read. */
export const PROBE_TIMEOUT_MS = 5_000;
export const PROBE_MAX_BYTES = 256 * 1024;

/** What a rule sends to be let in, resolved: the secret is already decrypted. */
export interface ProbeAuth {
  kind: VersionAuthKind;
  /** Header name when `kind` is `header`. */
  header?: string | null;
  secret?: string | null;
}

export interface ProbeRequest {
  url: string;
  headers?: Record<string, string>;
  auth?: ProbeAuth;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

/**
 * What came back. Flat rather than a discriminated union because a failed probe
 * still carries findings the rule editor shows: a 404 has a status, and a body
 * that arrived but did not parse is the very thing its author needs to see.
 */
export interface ProbeResult {
  ok: boolean;
  status: number | null;
  body: string;
  reason: CodedMessage | null;
}

/**
 * Reads one version endpoint, under the constraints that make it safe to point
 * a tenant-authored URL at this process.
 *
 * - **Only http and https.** `file:` reads the container, and the rest of the
 *   schemes are worse.
 * - **The resolved address is checked, and then connected to.** Checking the
 *   hostname would be theatre: a name resolves wherever its owner points it,
 *   and resolving twice — once to check, once to connect — is the rebinding
 *   attack itself. `lookup` hands the socket the very address that passed.
 * - **No redirect is followed.** A 302 to `http://169.254.169.254/` would
 *   otherwise walk straight past the check above, carrying the rule's secret
 *   with it. The redirect is reported instead, so its author points the rule at
 *   wherever it was going.
 * - **A timeout and a size cap**, because the endpoint belongs to somebody else
 *   and a collection cycle waits behind this.
 *
 * Nothing here is about the Git platform, so none of it touches the API budget:
 * these calls are made against the customer's own application.
 */
export async function probe(request: ProbeRequest): Promise<ProbeResult> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return failed({ code: 'errors.version.invalidUrl', params: { url: request.url } });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return failed({
      code: 'errors.version.unsupportedScheme',
      params: { scheme: url.protocol.replace(':', '') },
    });
  }

  // An address written into the URL never reaches `lookup`, which only runs for
  // names. Without this, `http://169.254.169.254/` is the shortest way past
  // every guarantee above.
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) && isForbiddenAddress(literal)) {
    return failed({ code: 'errors.version.forbiddenAddress', params: { host: literal } });
  }

  const timeoutMs = request.timeoutMs ?? PROBE_TIMEOUT_MS;
  const maxBytes = request.maxBytes ?? PROBE_MAX_BYTES;
  const options: RequestOptions = {
    method: 'GET',
    headers: {
      accept: 'application/json, application/xml, text/xml, text/plain;q=0.9, */*;q=0.8',
      'user-agent': 'git-pulse-version-probe',
      ...request.headers,
      ...authHeaders(request.auth),
    },
    timeout: timeoutMs,
    lookup: guardedLookup,
    signal: request.signal,
  };

  return new Promise<ProbeResult>((resolve) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    // Settled once: a socket can time out while its response is already being
    // read, and a probe reporting twice would resolve the promise on whichever
    // event came first and then throw on the second.
    let settled = false;
    const done = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = send(url, options, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.destroy();
        return done({
          ok: false,
          status,
          body: '',
          reason: {
            code: 'errors.version.redirected',
            params: { status, location: res.headers.location ?? '' },
          },
        });
      }

      const chunks: Buffer[] = [];
      let read = 0;
      res.on('data', (chunk: Buffer) => {
        read += chunk.length;
        if (read > maxBytes) {
          res.destroy();
          done({
            ok: false,
            status,
            body: '',
            reason: { code: 'errors.version.bodyTooLarge', params: { limit: maxBytes } },
          });
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (status < 200 || status >= 300) {
          return done({
            ok: false,
            status,
            body,
            reason: { code: 'errors.version.httpStatus', params: { status } },
          });
        }
        done({ ok: true, status, body, reason: null });
      });
      res.on('error', (e) => done(failed(unreachable(e), status)));
    });

    req.on('timeout', () => {
      // `timeout` only fires on socket inactivity; the request has to be torn
      // down by hand, or a silent endpoint holds the connection for ever.
      req.destroy();
      done(failed({ code: 'errors.version.timeout', params: { timeoutMs } }));
    });
    req.on('error', (e) => done(failed(unreachable(e))));
    req.end();
  });
}

/**
 * Resolves a name and refuses everything that resolved into a range the probe
 * must not reach, then hands the socket what is left.
 *
 * All the addresses are read, not the first: a name answering with one public
 * and one private address would otherwise be a coin toss, and the whole point
 * is that it never resolves to the private one here.
 */
const guardedLookup: RequestOptions['lookup'] = (hostname, options, callback) => {
  dnsLookup(hostname, { ...(options as object), all: true }, (error, addresses) => {
    if (error) return callback(error, '', 0);

    const allowed = (addresses as LookupAddress[]).filter(
      (candidate) => !isForbiddenAddress(candidate.address),
    );
    if (allowed.length === 0) {
      return callback(new Error(`${hostname} resolves to no address a probe may reach`), '', 0);
    }
    // `all` is what the caller asked for, not what we asked DNS for.
    if ((options as { all?: boolean }).all) return callback(null, allowed as never);
    callback(null, allowed[0].address, allowed[0].family);
  });
};

function authHeaders(auth: ProbeAuth | undefined): Record<string, string> {
  if (!auth || auth.kind === 'none' || !auth.secret) return {};
  if (auth.kind === 'bearer') return { authorization: `Bearer ${auth.secret}` };
  // The secret is `user:password`, as it is typed: encoding it here rather than
  // storing two fields keeps every scheme to one secret.
  if (auth.kind === 'basic') {
    return { authorization: `Basic ${Buffer.from(auth.secret).toString('base64')}` };
  }
  return auth.header ? { [auth.header]: auth.secret } : {};
}

function failed(reason: CodedMessage, status: number | null = null): ProbeResult {
  return { ok: false, status, body: '', reason };
}

/**
 * Everything the network can say, said the same way. The message is passed
 * through because it is the only thing distinguishing a refused address from a
 * name that does not exist, and both are fixed in the rule.
 */
function unreachable(e: unknown): CodedMessage {
  const detail = e instanceof Error ? e.message : String(e);
  return { code: 'errors.version.unreachable', params: { detail: detail.slice(0, 200) } };
}
