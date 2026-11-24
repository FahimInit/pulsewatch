import { describe, it, expect } from 'vitest';
import {
  getBlockedIpReason,
  validateMonitorUrlStructure,
  sanitizeMonitorHeaders,
} from '../src';

describe('SSRF IP, URL & Header Security Guards (@pulsewatch/shared)', () => {
  it('allows legitimate public IPv4 and IPv6 addresses', () => {
    expect(getBlockedIpReason('93.184.216.34')).toBeNull();
    expect(getBlockedIpReason('1.1.1.1')).toBeNull();
    expect(getBlockedIpReason('8.8.8.8')).toBeNull();
    expect(getBlockedIpReason('2606:2800:220:1:248:1893:25c8:1946')).toBeNull();
    expect(getBlockedIpReason('::ffff:93.184.216.34')).toBeNull();
  });

  it('blocks private, loopback, link-local, metadata, CGNAT, multicast, and mapped IPv6 targets', () => {
    expect(getBlockedIpReason('127.0.0.1')).toContain('Loopback');
    expect(getBlockedIpReason('10.24.0.8')).toContain('RFC 1918');
    expect(getBlockedIpReason('172.16.5.4')).toContain('RFC 1918');
    expect(getBlockedIpReason('172.31.255.255')).toContain('RFC 1918');
    expect(getBlockedIpReason('192.168.1.1')).toContain('RFC 1918');
    expect(getBlockedIpReason('169.254.169.254')).toContain('metadata');
    expect(getBlockedIpReason('100.100.100.200')).toContain('metadata');
    expect(getBlockedIpReason('0.0.0.0')).toContain('unspecified');
    expect(getBlockedIpReason('224.0.0.1')).toContain('Multicast');
    expect(getBlockedIpReason('::1')).toContain('Loopback');
    expect(getBlockedIpReason('fe80::1')).toContain('Link-local');
    expect(getBlockedIpReason('fd12:3456:789a::1')).toContain('Unique local');
    expect(getBlockedIpReason('::ffff:127.0.0.1')).toContain('Loopback');
    expect(getBlockedIpReason('::ffff:169.254.169.254')).toContain('metadata');
    expect(getBlockedIpReason('64:ff9b::10.0.0.1')).toContain('NAT64');
  });

  it('validates URL protocols, credentials, obfuscated IPs, and restricted ports', () => {
    expect(validateMonitorUrlStructure('https://api.example.com/health').valid).toBe(true);
    expect(validateMonitorUrlStructure('file:///etc/passwd').valid).toBe(false);
    expect(validateMonitorUrlStructure('gopher://127.0.0.1:6379/_INFO').valid).toBe(false);
    expect(validateMonitorUrlStructure('https://user:secret@example.com/api').valid).toBe(false);
    expect(validateMonitorUrlStructure('http://localhost:3000/health').valid).toBe(false);
    expect(validateMonitorUrlStructure('http://redis.internal/ping').valid).toBe(false);
    expect(validateMonitorUrlStructure('http://2130706433/').valid).toBe(false);
    expect(validateMonitorUrlStructure('http://0177.0.0.1/').valid).toBe(false);
    expect(validateMonitorUrlStructure('http://api.example.com:6379/').valid).toBe(false);
    expect(validateMonitorUrlStructure('http://api.example.com:5432/').valid).toBe(false);
  });

  it('rejects hop-by-hop overrides and CRLF header smuggling', () => {
    expect(
      sanitizeMonitorHeaders({
        'X-Api-Key': 'token-123',
        Accept: 'application/json',
      }).valid,
    ).toBe(true);

    expect(sanitizeMonitorHeaders({ Host: 'internal.corp' }).valid).toBe(false);
    expect(sanitizeMonitorHeaders({ 'Transfer-Encoding': 'chunked' }).valid).toBe(false);
    expect(sanitizeMonitorHeaders({ 'X-Injected': 'ok\r\nEvil: 1' }).valid).toBe(false);
  });
});
