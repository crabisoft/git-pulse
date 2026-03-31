/**
 * Whether an address belongs to a range a probe must never reach.
 *
 * The rule this enforces: a version endpoint is a customer's application on the
 * public internet, and the URL naming it is typed into a form by a tenant. Left
 * unchecked, that form addresses everything this process can reach — the
 * container's own ports, the database, a neighbour's service, and the cloud
 * metadata endpoint at 169.254.169.254, whose answer is a set of credentials.
 * The reply would come back through the rule editor, which renders it.
 *
 * Refusing by range rather than by allowing a list of hosts, because the hosts
 * are the tenant's and cannot be known here. Checked against the resolved
 * address rather than the hostname: a name is free to resolve wherever its
 * owner points it, and `localtest.me` resolves to 127.0.0.1 today.
 *
 * Everything reserved is refused, not merely everything private — a range that
 * carries no ordinary traffic carries nothing this feature wants, and the
 * documentation ranges are where a probe reaching the wrong network lands.
 */
export function isForbiddenAddress(ip: string): boolean {
  const mapped = embeddedIpv4(ip);
  if (mapped) return isForbiddenIpv4(mapped);
  return ip.includes(':') ? isForbiddenIpv6(ip) : isForbiddenIpv4(ip);
}

function isForbiddenIpv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    // Unparseable is refused: an address nobody can read is not one to connect to.
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 || // this network
    a === 10 || // private
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, and the cloud metadata endpoint
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0) || // protocol assignments and TEST-NET-1
    (a === 192 && b === 88) || // 6to4 relay anycast
    (a === 192 && b === 168) || // private
    (a === 198 && b >= 18 && b <= 19) || // benchmarking
    (a === 198 && b === 51) || // TEST-NET-2
    (a === 203 && b === 0) || // TEST-NET-3
    a >= 224 // multicast, reserved, and the broadcast address
  );
}

function isForbiddenIpv6(ip: string): boolean {
  const bytes = parseIpv6(ip);
  if (!bytes) return true;

  const unspecifiedOrLoopback = bytes.slice(0, 15).every((b) => b === 0) && bytes[15] <= 1;
  return (
    unspecifiedOrLoopback ||
    (bytes[0] & 0xfe) === 0xfc || // unique local, fc00::/7
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) || // link-local, fe80::/10
    bytes[0] === 0xff // multicast
  );
}

/**
 * The IPv4 address an IPv6 one carries, when it carries one.
 *
 * The transition ranges are how a refused v4 address gets asked for a second
 * time in v6 clothing: `::ffff:127.0.0.1` and `2002:7f00:1::` both end up at
 * loopback, and only the embedded address says so.
 */
function embeddedIpv4(ip: string): string | null {
  if (!ip.includes(':')) return null;
  const dotted = ip.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];

  const bytes = parseIpv6(ip);
  if (!bytes) return null;
  const asIpv4 = (offset: number) => bytes.slice(offset, offset + 4).join('.');

  // ::ffff:0:0/96 — IPv4-mapped.
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return asIpv4(12);
  }
  // 2002::/16 — 6to4, which carries its v4 address in the next four bytes.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return asIpv4(2);
  // 64:ff9b::/96 — NAT64.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return asIpv4(12);
  }
  return null;
}

/** The sixteen bytes of an IPv6 address, or null when it is not one. */
function parseIpv6(ip: string): number[] | null {
  const zone = ip.indexOf('%');
  const address = zone === -1 ? ip : ip.slice(0, zone);
  const halves = address.split('::');
  if (halves.length > 2) return null;

  const toWords = (part: string): number[] | null => {
    if (!part) return [];
    const groups = part.split(':');
    const words: number[] = [];
    for (const group of groups) {
      // A trailing dotted quad — `::ffff:127.0.0.1` — is two words written the
      // other way round.
      if (group.includes('.')) {
        const octets = group.split('.').map(Number);
        if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
          return null;
        }
        words.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      words.push(parseInt(group, 16));
    }
    return words;
  };

  const head = toWords(halves[0]);
  const tail = halves.length === 2 ? toWords(halves[1]) : [];
  if (!head || !tail) return null;

  const filled = 8 - head.length - tail.length;
  if (halves.length === 2 ? filled < 0 : filled !== 0) return null;
  const words = [...head, ...Array<number>(halves.length === 2 ? filled : 0).fill(0), ...tail];

  return words.flatMap((word) => [(word >> 8) & 0xff, word & 0xff]);
}
