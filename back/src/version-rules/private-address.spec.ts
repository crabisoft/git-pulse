import { describe, expect, it } from 'vitest';
import { isForbiddenAddress } from './private-address';

describe('isForbiddenAddress', () => {
  it('lets an ordinary public address through', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.0.1']) {
      expect(isForbiddenAddress(ip), ip).toBe(false);
    }
  });

  it('refuses the ranges a probe has no business reaching', () => {
    for (const ip of [
      '127.0.0.1', // loopback
      '10.1.2.3', // private
      '172.16.0.1', // private
      '172.31.255.254', // private, last of the block
      '192.168.1.1', // private
      '100.64.0.1', // carrier-grade NAT
      '0.0.0.0',
      '224.0.0.1', // multicast
      '255.255.255.255',
      '198.18.0.1', // benchmarking
      '203.0.113.1', // documentation
    ]) {
      expect(isForbiddenAddress(ip), ip).toBe(true);
    }
  });

  it('refuses the cloud metadata endpoint, which is the one that hands out credentials', () => {
    expect(isForbiddenAddress('169.254.169.254')).toBe(true);
    expect(isForbiddenAddress('fd00:ec2::254')).toBe(true);
  });

  it('refuses the IPv6 ranges', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
      expect(isForbiddenAddress(ip), ip).toBe(true);
    }
  });

  it('lets a public IPv6 address through', () => {
    for (const ip of ['2606:2800:220:1:248:1893:25c8:1946', '2001:4860:4860::8888']) {
      expect(isForbiddenAddress(ip), ip).toBe(false);
    }
  });

  it('sees through the transition ranges', () => {
    // The same refused address, asked for again in v6 clothing.
    expect(isForbiddenAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isForbiddenAddress('::ffff:7f00:1')).toBe(true);
    expect(isForbiddenAddress('2002:7f00:1::')).toBe(true);
    expect(isForbiddenAddress('64:ff9b::169.254.169.254')).toBe(true);
    // And a public one stays reachable through the same mapping.
    expect(isForbiddenAddress('::ffff:93.184.216.34')).toBe(false);
  });

  it('ignores the zone a link-local address may carry', () => {
    expect(isForbiddenAddress('fe80::1%eth0')).toBe(true);
  });

  it('refuses what it cannot read, rather than assuming it is public', () => {
    for (const ip of ['', 'not-an-ip', '1.2.3', '1.2.3.4.5', '999.1.1.1', ':::1', '1::2::3']) {
      expect(isForbiddenAddress(ip), ip).toBe(true);
    }
  });
});
