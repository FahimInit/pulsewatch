import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import {
  getBlockedIpReason,
  validateMonitorUrlStructure,
  sanitizeMonitorHeaders,
  type CheckResultStatus,
  type CheckErrorType,
  type HttpMethod,
  type KeywordMatchType,
} from '@pulsewatch/shared';

export type CustomLookupResolver = (
  hostname: string,
) => Promise<Array<{ address: string; family: 4 | 6 }>>;

export interface HttpCheckConfig {
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  body?: string | null;
  expectedStatusCodes: number[];
  timeoutMs: number;
  degradedThresholdMs: number;
  keyword?: string | null;
  keywordMatchType?: KeywordMatchType | null;
  followRedirects?: boolean;
  maxRedirects?: number;
  maxResponseBytes?: number;
  allowPrivateTargets?: boolean;
  customLookup?: CustomLookupResolver;
}

export interface HttpCheckOutcome {
  status: CheckResultStatus;
  statusCode: number | null;
  responseTimeMs: number;
  dnsTimeMs: number;
  connectTimeMs: number;
  ttfbMs: number;
  responseSizeBytes: number;
  keywordMatched: boolean | null;
  errorType: CheckErrorType | null;
  errorMessage: string | null;
  resolvedIp: string | null;
}

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

class PayloadTooLargeCheckError extends Error {
  constructor(maxBytes: number) {
    super(`Response exceeded maximum allowed size of ${maxBytes} bytes`);
    this.name = 'PayloadTooLargeCheckError';
  }
}

async function resolveAndValidateTargetIp(
  hostname: string,
  allowPrivateTargets: boolean,
  customLookup?: CustomLookupResolver,
): Promise<{ address: string; family: 4 | 6; dnsMs: number }> {
  const cleanHost = hostname.replace(/^\[|\]$/g, '');
  const ipVer = net.isIP(cleanHost);

  if (ipVer === 4 || ipVer === 6) {
    if (!allowPrivateTargets) {
      const blocked = getBlockedIpReason(cleanHost);
      if (blocked) throw new SsrfBlockedError(blocked);
    }
    return { address: cleanHost, family: ipVer, dnsMs: 0 };
  }

  const dnsStart = performance.now();
  const records: Array<{ address: string; family: number }> = customLookup
    ? await customLookup(cleanHost)
    : await dns.promises.lookup(cleanHost, { all: true, verbatim: true });
  const dnsMs = Math.max(0, Math.round(performance.now() - dnsStart));

  if (!records || records.length === 0) {
    const err = new Error(`ENOTFOUND ${cleanHost}`) as NodeJS.ErrnoException;
    err.code = 'ENOTFOUND';
    throw err;
  }

  if (!allowPrivateTargets) {
    for (const r of records) {
      const blocked = getBlockedIpReason(r.address);
      if (blocked) {
        throw new SsrfBlockedError(
          `Resolved IP ${r.address} for '${cleanHost}' blocked (${blocked})`,
        );
      }
    }
  }

  const chosen = records[0];
  return {
    address: chosen.address,
    family: chosen.family === 6 ? 6 : 4,
    dnsMs,
  };
}

function classifyNetworkError(err: unknown): {
  errorType: CheckErrorType;
  errorMessage: string;
} {
  if (err instanceof SsrfBlockedError) {
    return { errorType: 'SSRF_BLOCKED', errorMessage: err.message };
  }
  if (err instanceof PayloadTooLargeCheckError) {
    return { errorType: 'RESPONSE_TOO_LARGE', errorMessage: err.message };
  }

  const e = err as NodeJS.ErrnoException;
  const code = e?.code || '';
  const msg = e?.message || 'Unknown network failure';

  if (e?.name === 'AbortError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || msg.includes('timed out')) {
    return { errorType: 'TIMEOUT', errorMessage: 'Request timed out' };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') {
    return { errorType: 'DNS_ERROR', errorMessage: `DNS resolution failed (${code})` };
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH') {
    return { errorType: 'CONNECTION_REFUSED', errorMessage: `Connection failed (${code})` };
  }
  if (code.startsWith('ERR_TLS') || code.includes('CERT') || code.includes('SSL')) {
    return { errorType: 'TLS_ERROR', errorMessage: `TLS handshake error (${code || msg})` };
  }
  return { errorType: 'NETWORK_ERROR', errorMessage: msg.slice(0, 300) };
}

/**
 * Executes a hardened HTTP/HTTPS check with socket-pinned DNS resolution,
 * manual redirect re-validation, response byte limits, and sub-phase timing capture.
 */
export async function executeHttpHealthCheck(
  config: HttpCheckConfig,
): Promise<HttpCheckOutcome> {
  const allowPrivate = Boolean(
    config.allowPrivateTargets ?? process.env.ALLOW_PRIVATE_MONITOR_TARGETS === 'true',
  );
  const maxRedirects = config.maxRedirects ?? 5;
  const maxBytes = config.maxResponseBytes ?? Number(process.env.MAX_RESPONSE_SIZE_BYTES || 1_048_576);
  const needBodyText = Boolean(config.keyword && config.keyword.trim().length > 0);

  const overallStart = performance.now();
  const deadline = overallStart + config.timeoutMs;

  let currentUrl = config.url;
  let currentMethod: HttpMethod = config.method;
  let currentBody = config.method === 'POST' ? config.body ?? null : null;

  let totalDnsMs = 0;
  let lastConnectMs = 0;
  let lastTtfbMs = 0;
  let lastResolvedIp: string | null = null;

  const headerCheck = sanitizeMonitorHeaders(config.headers);
  if (!headerCheck.valid) {
    return {
      status: 'DOWN',
      statusCode: null,
      responseTimeMs: 0,
      dnsTimeMs: 0,
      connectTimeMs: 0,
      ttfbMs: 0,
      responseSizeBytes: 0,
      keywordMatched: null,
      errorType: 'SSRF_BLOCKED',
      errorMessage: headerCheck.reason || 'Invalid custom headers',
      resolvedIp: null,
    };
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const remainingMs = Math.round(deadline - performance.now());
    if (remainingMs <= 0) {
      return {
        status: 'DOWN',
        statusCode: null,
        responseTimeMs: Math.round(performance.now() - overallStart),
        dnsTimeMs: totalDnsMs,
        connectTimeMs: lastConnectMs,
        ttfbMs: lastTtfbMs,
        responseSizeBytes: 0,
        keywordMatched: null,
        errorType: 'TIMEOUT',
        errorMessage: `Check exceeded timeout of ${config.timeoutMs}ms`,
        resolvedIp: lastResolvedIp,
      };
    }

    // Validate URL structure at every hop (initial + every redirect target)
    const urlCheck = validateMonitorUrlStructure(currentUrl, {
      allowPrivateTargets: allowPrivate,
    });
    if (!urlCheck.valid || !urlCheck.normalizedUrl) {
      return {
        status: 'DOWN',
        statusCode: null,
        responseTimeMs: Math.round(performance.now() - overallStart),
        dnsTimeMs: totalDnsMs,
        connectTimeMs: lastConnectMs,
        ttfbMs: lastTtfbMs,
        responseSizeBytes: 0,
        keywordMatched: null,
        errorType: 'SSRF_BLOCKED',
        errorMessage: urlCheck.reason || 'Blocked target URL',
        resolvedIp: lastResolvedIp,
      };
    }

    const parsedUrl = new URL(urlCheck.normalizedUrl);

    let pinned: { address: string; family: 4 | 6; dnsMs: number };
    try {
      pinned = await resolveAndValidateTargetIp(
        parsedUrl.hostname,
        allowPrivate,
        config.customLookup,
      );
      totalDnsMs += pinned.dnsMs;
      lastResolvedIp = pinned.address;
    } catch (err) {
      const classified = classifyNetworkError(err);
      return {
        status: 'DOWN',
        statusCode: null,
        responseTimeMs: Math.round(performance.now() - overallStart),
        dnsTimeMs: totalDnsMs,
        connectTimeMs: 0,
        ttfbMs: 0,
        responseSizeBytes: 0,
        keywordMatched: null,
        errorType: classified.errorType,
        errorMessage: classified.errorMessage,
        resolvedIp: lastResolvedIp,
      };
    }

    try {
      const hopResult = await performSinglePinnedRequest({
        parsedUrl,
        pinnedAddress: pinned.address,
        pinnedFamily: pinned.family,
        method: currentMethod,
        headers: headerCheck.sanitized,
        body: currentBody,
        timeoutMs: Math.max(50, Math.round(deadline - performance.now())),
        maxBytes,
        captureText: needBodyText,
      });

      lastConnectMs = hopResult.connectMs;
      lastTtfbMs = hopResult.ttfbMs;

      // Handle manual redirect re-validation
      if (
        config.followRedirects !== false &&
        REDIRECT_STATUS_CODES.has(hopResult.statusCode) &&
        hopResult.locationHeader
      ) {
        if (hop === maxRedirects) {
          return {
            status: 'DOWN',
            statusCode: hopResult.statusCode,
            responseTimeMs: Math.round(performance.now() - overallStart),
            dnsTimeMs: totalDnsMs,
            connectTimeMs: lastConnectMs,
            ttfbMs: lastTtfbMs,
            responseSizeBytes: hopResult.bytesRead,
            keywordMatched: null,
            errorType: 'NETWORK_ERROR',
            errorMessage: `Too many redirects (exceeded ${maxRedirects} hops)`,
            resolvedIp: lastResolvedIp,
          };
        }

        currentUrl = new URL(hopResult.locationHeader, parsedUrl).toString();
        if (
          hopResult.statusCode === 303 ||
          ((hopResult.statusCode === 301 || hopResult.statusCode === 302) &&
            currentMethod === 'POST')
        ) {
          currentMethod = 'GET';
          currentBody = null;
        }
        continue;
      }

      const totalElapsedMs = Math.max(1, Math.round(performance.now() - overallStart));

      // 1. Validate status code
      const statusOk = config.expectedStatusCodes.includes(hopResult.statusCode);
      if (!statusOk) {
        return {
          status: 'DOWN',
          statusCode: hopResult.statusCode,
          responseTimeMs: totalElapsedMs,
          dnsTimeMs: totalDnsMs,
          connectTimeMs: lastConnectMs,
          ttfbMs: lastTtfbMs,
          responseSizeBytes: hopResult.bytesRead,
          keywordMatched: null,
          errorType: 'INVALID_STATUS',
          errorMessage: `Unexpected HTTP status ${hopResult.statusCode} (expected ${config.expectedStatusCodes.join(', ')})`,
          resolvedIp: lastResolvedIp,
        };
      }

      // 2. Validate keyword assertion if configured
      let keywordMatched: boolean | null = null;
      if (needBodyText && config.keyword) {
        const needle = config.keyword.trim();
        const contains = hopResult.bodyText.includes(needle);
        const mode = config.keywordMatchType || 'CONTAINS';
        keywordMatched = mode === 'CONTAINS' ? contains : !contains;

        if (!keywordMatched) {
          return {
            status: 'DOWN',
            statusCode: hopResult.statusCode,
            responseTimeMs: totalElapsedMs,
            dnsTimeMs: totalDnsMs,
            connectTimeMs: lastConnectMs,
            ttfbMs: lastTtfbMs,
            responseSizeBytes: hopResult.bytesRead,
            keywordMatched: false,
            errorType: 'KEYWORD_MISMATCH',
            errorMessage:
              mode === 'CONTAINS'
                ? `Response body did not contain required keyword '${needle}'`
                : `Response body contained forbidden keyword '${needle}'`,
            resolvedIp: lastResolvedIp,
          };
        }
      }

      // 3. Classify OPERATIONAL vs DEGRADED based on latency threshold
      const finalStatus: CheckResultStatus =
        totalElapsedMs > config.degradedThresholdMs ? 'DEGRADED' : 'OPERATIONAL';

      return {
        status: finalStatus,
        statusCode: hopResult.statusCode,
        responseTimeMs: totalElapsedMs,
        dnsTimeMs: totalDnsMs,
        connectTimeMs: lastConnectMs,
        ttfbMs: lastTtfbMs,
        responseSizeBytes: hopResult.bytesRead,
        keywordMatched,
        errorType: null,
        errorMessage: null,
        resolvedIp: lastResolvedIp,
      };
    } catch (err) {
      const classified = classifyNetworkError(err);
      return {
        status: 'DOWN',
        statusCode: null,
        responseTimeMs: Math.round(performance.now() - overallStart),
        dnsTimeMs: totalDnsMs,
        connectTimeMs: lastConnectMs,
        ttfbMs: lastTtfbMs,
        responseSizeBytes: 0,
        keywordMatched: null,
        errorType: classified.errorType,
        errorMessage: classified.errorMessage,
        resolvedIp: lastResolvedIp,
      };
    }
  }

  return {
    status: 'DOWN',
    statusCode: null,
    responseTimeMs: Math.round(performance.now() - overallStart),
    dnsTimeMs: totalDnsMs,
    connectTimeMs: 0,
    ttfbMs: 0,
    responseSizeBytes: 0,
    keywordMatched: null,
    errorType: 'UNKNOWN',
    errorMessage: 'Check terminated unexpectedly',
    resolvedIp: lastResolvedIp,
  };
}

interface SingleHopParams {
  parsedUrl: URL;
  pinnedAddress: string;
  pinnedFamily: 4 | 6;
  method: HttpMethod;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
  maxBytes: number;
  captureText: boolean;
}

interface SingleHopResult {
  statusCode: number;
  locationHeader: string | null;
  bytesRead: number;
  bodyText: string;
  connectMs: number;
  ttfbMs: number;
}

function performSinglePinnedRequest(params: SingleHopParams): Promise<SingleHopResult> {
  return new Promise((resolve, reject) => {
    const isHttps = params.parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const reqStart = performance.now();
    let socketAssignedAt = reqStart;
    let connectMs = 0;
    let ttfbMs = 0;
    let settled = false;

    const finishErr = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const requestHeaders: Record<string, string> = {
      'User-Agent': 'Pulsewatch-Monitor/1.0 (+https://pulsewatch.dev)',
      Accept: '*/*',
      Connection: 'close',
      ...params.headers,
    };

    const bodyBuffer =
      params.method === 'POST' && params.body ? Buffer.from(params.body, 'utf8') : null;
    if (bodyBuffer) {
      requestHeaders['Content-Length'] = String(bodyBuffer.byteLength);
      if (!requestHeaders['Content-Type'] && !requestHeaders['content-type']) {
        requestHeaders['Content-Type'] = 'application/json';
      }
    }

    const req = transport.request(
      {
        protocol: params.parsedUrl.protocol,
        hostname: params.parsedUrl.hostname.replace(/^\[|\]$/g, ''),
        port: params.parsedUrl.port || (isHttps ? 443 : 80),
        path: `${params.parsedUrl.pathname}${params.parsedUrl.search}`,
        method: params.method,
        headers: requestHeaders,
        agent: false,
        servername: net.isIP(params.parsedUrl.hostname.replace(/^\[|\]$/g, ''))
          ? undefined
          : params.parsedUrl.hostname,
        // Pin socket directly to the pre-validated IP address (eliminating DNS rebinding TOCTOU)
        lookup: (_hostname, opts, cb) => {
          const allRequested = typeof opts === 'object' && opts !== null && opts.all === true;
          if (allRequested) {
            (cb as (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void)(
              null,
              [{ address: params.pinnedAddress, family: params.pinnedFamily }],
            );
          } else {
            (
              cb as (
                err: NodeJS.ErrnoException | null,
                address: string,
                family: number,
              ) => void
            )(null, params.pinnedAddress, params.pinnedFamily);
          }
        },
      },
      (res) => {
        ttfbMs = Math.max(0, Math.round(performance.now() - reqStart));
        let bytesRead = 0;
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => {
          bytesRead += chunk.byteLength;
          if (bytesRead > params.maxBytes) {
            const tooLargeErr = new PayloadTooLargeCheckError(params.maxBytes);
            clearTimeout(timer);
            finishErr(tooLargeErr);
            req.destroy(tooLargeErr);
            return;
          }
          if (params.captureText) {
            chunks.push(chunk);
          }
        });

        res.on('end', () => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          const loc = res.headers.location;
          resolve({
            statusCode: res.statusCode || 0,
            locationHeader: Array.isArray(loc) ? loc[0] : loc ?? null,
            bytesRead,
            bodyText: params.captureText ? Buffer.concat(chunks).toString('utf8') : '',
            connectMs,
            ttfbMs,
          });
        });

        res.on('error', (err) => {
          clearTimeout(timer);
          finishErr(err);
        });
      },
    );

    req.on('socket', (socket) => {
      socketAssignedAt = performance.now();
      const onConnected = () => {
        connectMs = Math.max(0, Math.round(performance.now() - socketAssignedAt));
      };
      if (isHttps) {
        socket.once('secureConnect', onConnected);
      } else {
        socket.once('connect', onConnected);
      }
    });

    const timer = setTimeout(() => {
      const timeoutErr = new Error('Request timed out') as NodeJS.ErrnoException;
      timeoutErr.code = 'ETIMEDOUT';
      req.destroy(timeoutErr);
      finishErr(timeoutErr);
    }, params.timeoutMs);

    req.on('error', (err) => {
      clearTimeout(timer);
      finishErr(err);
    });

    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}
