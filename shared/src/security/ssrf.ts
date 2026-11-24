import net from 'node:net';

export interface UrlValidationResult {
  valid: boolean;
  normalizedUrl?: string;
  reason?: string;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.lan',
  '.corp',
];

const BLOCKED_INFRA_PORTS = new Set([
  21,    // FTP
  22,    // SSH
  23,    // Telnet
  25,    // SMTP
  110,   // POP3
  135,   // RPC
  139,   // NetBIOS
  143,   // IMAP
  445,   // SMB
  1433,  // MSSQL
  1521,  // Oracle
  2375,  // Docker daemon
  2376,  // Docker TLS
  3306,  // MySQL
  3389,  // RDP
  5432,  // PostgreSQL
  5672,  // RabbitMQ
  6379,  // Redis
  9200,  // Elasticsearch
  11211, // Memcached
  27017, // MongoDB
]);

const FORBIDDEN_CUSTOM_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
]);

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith('0')) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = ((value << 8) | octet) >>> 0;
  }
  return value >>> 0;
}

function inIpv4Cidr(ipUint: number, baseIp: string, prefixBits: number): boolean {
  const base = ipv4ToUint32(baseIp);
  if (base === null) return false;
  const mask = prefixBits === 0 ? 0 : (~((1 << (32 - prefixBits)) - 1)) >>> 0;
  return (ipUint & mask) >>> 0 === (base & mask) >>> 0;
}

const BLOCKED_IPV4_CIDRS: ReadonlyArray<[string, number, string]> = [
  ['0.0.0.0', 8, 'Current/unspecified network (0.0.0.0/8)'],
  ['10.0.0.0', 8, 'RFC 1918 private network (10.0.0.0/8)'],
  ['100.64.0.0', 10, 'Carrier-grade NAT / cloud metadata range (100.64.0.0/10)'],
  ['127.0.0.0', 8, 'Loopback range (127.0.0.0/8)'],
  ['169.254.0.0', 16, 'Link-local / cloud metadata range (169.254.0.0/16)'],
  ['172.16.0.0', 12, 'RFC 1918 private network (172.16.0.0/12)'],
  ['192.0.0.0', 24, 'IETF protocol assignments (192.0.0.0/24)'],
  ['192.0.2.0', 24, 'TEST-NET-1 documentation range (192.0.2.0/24)'],
  ['192.168.0.0', 16, 'RFC 1918 private network (192.168.0.0/16)'],
  ['198.18.0.0', 15, 'Benchmarking range (198.18.0.0/15)'],
  ['198.51.100.0', 24, 'TEST-NET-2 documentation range (198.51.100.0/24)'],
  ['203.0.113.0', 24, 'TEST-NET-3 documentation range (203.0.113.0/24)'],
  ['224.0.0.0', 4, 'Multicast range (224.0.0.0/4)'],
  ['240.0.0.0', 4, 'Reserved / broadcast range (240.0.0.0/4)'],
];

function expandIpv6ToGroups(rawIp: string): number[] | null {
  const zoneStripped = rawIp.split('%')[0].toLowerCase();
  if (!net.isIPv6(zoneStripped)) return null;

  let working = zoneStripped;
  // Convert trailing dotted-quad IPv4 (e.g. ::ffff:127.0.0.1) into two 16-bit groups
  const lastColon = working.lastIndexOf(':');
  if (lastColon !== -1 && working.slice(lastColon + 1).includes('.')) {
    const v4Part = working.slice(lastColon + 1);
    const v4Uint = ipv4ToUint32(v4Part);
    if (v4Uint === null) return null;
    const hi = ((v4Uint >>> 16) & 0xffff).toString(16);
    const lo = (v4Uint & 0xffff).toString(16);
    working = `${working.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const doubleColonParts = working.split('::');
  if (doubleColonParts.length > 2) return null;

  if (doubleColonParts.length === 2) {
    const left = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
    const right = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    const full = [...left, ...Array(missing).fill('0'), ...right];
    return full.map((g) => parseInt(g, 16));
  }

  const groups = working.split(':');
  if (groups.length !== 8) return null;
  return groups.map((g) => parseInt(g, 16));
}

function groupsToIpv4String(hi: number, lo: number): string {
  const a = (hi >>> 8) & 0xff;
  const b = hi & 0xff;
  const c = (lo >>> 8) & 0xff;
  const d = lo & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

/**
 * Classifies whether an IPv4 or IPv6 literal is unsafe (private, loopback, link-local,
 * metadata, CGNAT, multicast, reserved, or mapped private IPv4).
 * Returns `null` when safe/public, or a human-readable block reason when blocked.
 */
export function getBlockedIpReason(rawIp: string): string | null {
  const trimmed = rawIp.trim().replace(/^\[|\]$/g, '');
  const version = net.isIP(trimmed.split('%')[0]);

  if (version === 4) {
    const uint = ipv4ToUint32(trimmed);
    if (uint === null) return 'Malformed IPv4 address';
    for (const [cidrBase, prefix, label] of BLOCKED_IPV4_CIDRS) {
      if (inIpv4Cidr(uint, cidrBase, prefix)) {
        return `Blocked IPv4 target: ${label}`;
      }
    }
    return null;
  }

  if (version === 6) {
    if (trimmed.includes('%')) {
      return 'Blocked IPv6 target: Zone-scoped link-local address';
    }
    const groups = expandIpv6ToGroups(trimmed);
    if (!groups) return 'Malformed IPv6 address';

    const allZeroExceptLast = groups.slice(0, 7).every((g) => g === 0);
    // ::/128 unspecified
    if (allZeroExceptLast && groups[7] === 0) {
      return 'Blocked IPv6 target: Unspecified address (::/128)';
    }
    // ::1/128 loopback
    if (allZeroExceptLast && groups[7] === 1) {
      return 'Blocked IPv6 target: Loopback address (::1/128)';
    }
    // IPv4-mapped ::ffff:0:0/96
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
      const embeddedV4 = groupsToIpv4String(groups[6], groups[7]);
      const v4Reason = getBlockedIpReason(embeddedV4);
      if (v4Reason) return `Blocked IPv4-mapped IPv6 target (${v4Reason})`;
      return null;
    }
    // IPv4-compatible ::w.x.y.z (deprecated)
    if (groups.slice(0, 6).every((g) => g === 0)) {
      const embeddedV4 = groupsToIpv4String(groups[6], groups[7]);
      const v4Reason = getBlockedIpReason(embeddedV4);
      if (v4Reason) return `Blocked IPv4-compatible IPv6 target (${v4Reason})`;
    }
    // NAT64 well-known prefix 64:ff9b::/96
    if (
      groups[0] === 0x0064 &&
      groups[1] === 0xff9b &&
      groups[2] === 0 &&
      groups[3] === 0 &&
      groups[4] === 0 &&
      groups[5] === 0
    ) {
      const embeddedV4 = groupsToIpv4String(groups[6], groups[7]);
      const v4Reason = getBlockedIpReason(embeddedV4);
      if (v4Reason) return `Blocked NAT64 target (${v4Reason})`;
    }
    // Unique local fc00::/7 (fc00..fdff)
    if ((groups[0] & 0xfe00) === 0xfc00) {
      return 'Blocked IPv6 target: Unique local network (fc00::/7)';
    }
    // Link-local fe80::/10 (fe80..febf)
    if ((groups[0] & 0xffc0) === 0xfe80) {
      return 'Blocked IPv6 target: Link-local network (fe80::/10)';
    }
    // Multicast ff00::/8
    if ((groups[0] & 0xff00) === 0xff00) {
      return 'Blocked IPv6 target: Multicast range (ff00::/8)';
    }
    // Discard-only 100::/64
    if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) {
      return 'Blocked IPv6 target: Discard prefix (100::/64)';
    }
    // Documentation 2001:db8::/32
    if (groups[0] === 0x2001 && groups[1] === 0x0db8) {
      return 'Blocked IPv6 target: Documentation range (2001:db8::/32)';
    }

    return null;
  }

  return 'Invalid IP address literal';
}

export function isPublicIpAddress(ip: string): boolean {
  return getBlockedIpReason(ip) === null;
}

/**
 * Validates structural safety of a monitor URL (protocol, credentials, hostname, port, literal IPs)
 * before any DNS lookup or network request is attempted.
 */
export function validateMonitorUrlStructure(
  rawUrl: string,
  options: { allowPrivateTargets?: boolean } = {},
): UrlValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.length > 2048) {
    return { valid: false, reason: 'URL must be a non-empty string up to 2048 characters' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, reason: 'Invalid URL syntax' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only http:// and https:// protocols are permitted' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Embedded credentials in monitor URLs are prohibited' };
  }

  const rawHost = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!rawHost) {
    return { valid: false, reason: 'URL must include a valid hostname' };
  }

  // Reject single-integer or octal/hex IP obfuscations (e.g. http://2130706433 or http://0x7f000001)
  if (/^(0x[0-9a-f]+|\d+)$/i.test(rawHost)) {
    return { valid: false, reason: 'Numeric/hexadecimal IP obfuscation is prohibited' };
  }
  if (/^0\d+\./.test(rawHost) || /\.0\d+/.test(rawHost)) {
    return { valid: false, reason: 'Octal IP notation is prohibited' };
  }

  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return { valid: false, reason: 'Invalid TCP port' };
    }
    if (!options.allowPrivateTargets && BLOCKED_INFRA_PORTS.has(portNum)) {
      return { valid: false, reason: `Port ${portNum} is restricted for security reasons` };
    }
  }

  if (!options.allowPrivateTargets) {
    if (BLOCKED_HOSTNAMES.has(rawHost)) {
      return { valid: false, reason: `Hostname '${rawHost}' is blocked (internal/loopback)` };
    }
    for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
      if (rawHost.endsWith(suffix)) {
        return { valid: false, reason: `Internal domain suffix '${suffix}' is blocked` };
      }
    }

    if (net.isIP(rawHost) !== 0) {
      const ipBlockReason = getBlockedIpReason(rawHost);
      if (ipBlockReason) {
        return { valid: false, reason: ipBlockReason };
      }
    } else if (!rawHost.includes('.')) {
      return { valid: false, reason: 'Unqualified internal single-label hostnames are prohibited' };
    }
  }

  // Strip URL fragments since they are never sent over HTTP
  parsed.hash = '';

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
  };
}

/**
 * Sanitizes user-supplied HTTP request headers, rejecting CR/LF header injection
 * and hop-by-hop headers.
 */
export function sanitizeMonitorHeaders(
  headers: Record<string, string> | undefined | null,
): { valid: boolean; sanitized: Record<string, string>; reason?: string } {
  if (!headers) return { valid: true, sanitized: {} };

  const entries = Object.entries(headers);
  if (entries.length > 25) {
    return { valid: false, sanitized: {}, reason: 'Maximum of 25 custom headers allowed' };
  }

  const sanitized: Record<string, string> = {};
  for (const [rawKey, rawVal] of entries) {
    const key = rawKey.trim();
    if (!key) continue;

    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/.test(key)) {
      return { valid: false, sanitized: {}, reason: `Invalid HTTP header name '${key}'` };
    }
    if (FORBIDDEN_CUSTOM_HEADERS.has(key.toLowerCase())) {
      return { valid: false, sanitized: {}, reason: `Header '${key}' cannot be overridden` };
    }
    const value = String(rawVal ?? '');
    if (/[\r\n\0]/.test(value) || value.length > 2048) {
      return {
        valid: false,
        sanitized: {},
        reason: `Header '${key}' contains prohibited control characters or exceeds 2048 bytes`,
      };
    }
    sanitized[key] = value;
  }

  return { valid: true, sanitized };
}
