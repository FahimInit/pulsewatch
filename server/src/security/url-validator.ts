import dns from 'node:dns/promises';
import net from 'node:net';
import {
  getBlockedIpReason,
  validateMonitorUrlStructure,
  sanitizeMonitorHeaders,
} from '@pulsewatch/shared';
import { getEnv } from '../config/env';
import { BadRequestError } from '../utils/errors';

export type DnsLookupFn = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

const defaultDnsLookup: DnsLookupFn = (hostname) =>
  dns.lookup(hostname, { all: true, verbatim: true });

let activeDnsLookup: DnsLookupFn = defaultDnsLookup;

export function setCustomDnsLookupForTests(fn: DnsLookupFn | null): void {
  activeDnsLookup = fn ?? defaultDnsLookup;
}

/**
 * Performs structural URL validation AND pre-flight DNS resolution checks
 * to block SSRF attempts against private, loopback, link-local, metadata,
 * CGNAT, multicast, and mapped-IPv6 ranges.
 */
export async function assertSafeMonitorTarget(rawUrl: string): Promise<string> {
  const allowPrivate = getEnv().ALLOW_PRIVATE_MONITOR_TARGETS;

  const structural = validateMonitorUrlStructure(rawUrl, {
    allowPrivateTargets: allowPrivate,
  });

  if (!structural.valid || !structural.normalizedUrl) {
    throw new BadRequestError(
      structural.reason || 'Invalid monitor URL',
      'INVALID_MONITOR_URL',
    );
  }

  if (allowPrivate) {
    return structural.normalizedUrl;
  }

  const parsed = new URL(structural.normalizedUrl);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');

  // If literal IP, validateMonitorUrlStructure already verified it is public
  if (net.isIP(host) !== 0) {
    const reason = getBlockedIpReason(host);
    if (reason) {
      throw new BadRequestError(reason, 'SSRF_TARGET_BLOCKED');
    }
    return structural.normalizedUrl;
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await activeDnsLookup(host);
  } catch {
    throw new BadRequestError(
      `Unable to resolve DNS records for hostname '${host}'`,
      'DNS_RESOLUTION_FAILED',
    );
  }

  if (!records || records.length === 0) {
    throw new BadRequestError(
      `Hostname '${host}' did not resolve to any IP addresses`,
      'DNS_RESOLUTION_FAILED',
    );
  }

  for (const rec of records) {
    const blockedReason = getBlockedIpReason(rec.address);
    if (blockedReason) {
      throw new BadRequestError(
        `Target hostname '${host}' resolves to a restricted address (${blockedReason})`,
        'SSRF_TARGET_BLOCKED',
      );
    }
  }

  return structural.normalizedUrl;
}

export function assertSafeMonitorHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const result = sanitizeMonitorHeaders(headers);
  if (!result.valid) {
    throw new BadRequestError(
      result.reason || 'Invalid custom request headers',
      'INVALID_MONITOR_HEADERS',
    );
  }
  return result.sanitized;
}
