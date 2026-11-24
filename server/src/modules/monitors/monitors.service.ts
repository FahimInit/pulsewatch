import type { Request } from 'express';
import { Prisma, type MonitorStatus } from '@prisma/client';
import type { CreateMonitorInput, UpdateMonitorInput } from '@pulsewatch/shared';
import { prisma } from '../../config/prisma';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../utils/errors';
import {
  assertSafeMonitorTarget,
  assertSafeMonitorHeaders,
} from '../../security/url-validator';
import {
  syncMonitorSchedule,
  enqueueImmediateMonitorCheck,
} from '../../queues/monitor.queue';
import { recordAuditLog } from '../audit/audit.service';

interface UptimeAggRow {
  monitor_id: string;
  total_checks: bigint;
  healthy_checks: bigint;
  avg_latency: number | null;
}

async function compute24hMonitorMetrics(monitorIds: string[]) {
  if (monitorIds.length === 0) {
    return new Map<string, { uptime24h: number | null; avgResponseTime24h: number | null }>();
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<UptimeAggRow[]>`
    SELECT
      "monitor_id",
      COUNT(*)::bigint AS total_checks,
      COUNT(*) FILTER (WHERE "status" IN ('OPERATIONAL', 'DEGRADED'))::bigint AS healthy_checks,
      AVG("response_time_ms")::float AS avg_latency
    FROM "monitoring_results"
    WHERE "monitor_id" = ANY(${monitorIds}::uuid[])
      AND "checked_at" >= ${since}
    GROUP BY "monitor_id"
  `;

  const map = new Map<string, { uptime24h: number | null; avgResponseTime24h: number | null }>();
  for (const r of rows) {
    const total = Number(r.total_checks);
    const healthy = Number(r.healthy_checks);
    map.set(r.monitor_id, {
      uptime24h: total > 0 ? Number(((healthy / total) * 100).toFixed(2)) : null,
      avgResponseTime24h: r.avg_latency !== null ? Math.round(r.avg_latency) : null,
    });
  }
  return map;
}

export async function listProjectMonitors(
  projectId: string,
  filters: { search?: string; status?: string },
) {
  const where: Prisma.MonitorWhereInput = { projectId };

  if (filters.status && filters.status !== 'ALL') {
    where.status = filters.status as MonitorStatus;
  }

  if (filters.search?.trim()) {
    const q = filters.search.trim();
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { url: { contains: q, mode: 'insensitive' } },
    ];
  }

  const monitors = await prisma.monitor.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  const metricsMap = await compute24hMonitorMetrics(monitors.map((m) => m.id));

  return monitors.map((m) => {
    const stats = metricsMap.get(m.id);
    return {
      ...m,
      uptime24h: stats?.uptime24h ?? null,
      avgResponseTime24h: stats?.avgResponseTime24h ?? m.lastResponseTimeMs ?? null,
    };
  });
}

export async function createMonitor(
  projectId: string,
  monitorLimit: number,
  actorId: string,
  input: CreateMonitorInput,
  req: Request,
) {
  const currentCount = await prisma.monitor.count({ where: { projectId } });
  if (currentCount >= monitorLimit) {
    throw new ForbiddenError(
      `Project monitor limit reached (${monitorLimit}). Upgrade workspace plan or remove unused monitors.`,
      'MONITOR_LIMIT_REACHED',
    );
  }

  const normalizedUrl = await assertSafeMonitorTarget(input.url);
  const sanitizedHeaders = assertSafeMonitorHeaders(input.headers);

  if (input.method !== 'POST' && input.body) {
    throw new BadRequestError('Request body is only supported for POST monitors');
  }

  const keyword = input.keyword?.trim() || null;
  const keywordMatchType = keyword ? input.keywordMatchType || 'CONTAINS' : null;

  const monitor = await prisma.monitor.create({
    data: {
      projectId,
      name: input.name,
      url: normalizedUrl,
      method: input.method,
      headers: sanitizedHeaders as Prisma.InputJsonValue,
      body: input.method === 'POST' ? input.body ?? null : null,
      expectedStatusCodes: input.expectedStatusCodes,
      timeoutMs: input.timeoutMs,
      intervalSeconds: input.intervalSeconds,
      degradedThresholdMs: input.degradedThresholdMs,
      failureThreshold: input.failureThreshold,
      recoveryThreshold: input.recoveryThreshold,
      keyword,
      keywordMatchType,
      followRedirects: input.followRedirects,
      status: 'PENDING',
      createdById: actorId,
    },
  });

  await syncMonitorSchedule(monitor.id, monitor.intervalSeconds, true);
  await enqueueImmediateMonitorCheck(monitor.id, 'initial');

  await recordAuditLog({
    projectId,
    actorId,
    action: 'monitor.created',
    entityType: 'Monitor',
    entityId: monitor.id,
    metadata: { name: monitor.name, url: monitor.url, intervalSeconds: monitor.intervalSeconds },
    req,
  });

  return monitor;
}

export async function getMonitorById(projectId: string, monitorId: string) {
  const monitor = await prisma.monitor.findFirst({
    where: { id: monitorId, projectId },
    include: {
      incidents: {
        where: { status: { not: 'RESOLVED' } },
        orderBy: { startedAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!monitor) throw new NotFoundError('Monitor not found');

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [metrics24h, stats30d] = await Promise.all([
    compute24hMonitorMetrics([monitor.id]),
    prisma.$queryRaw<Array<{ total: bigint; healthy: bigint; avg_ms: number | null }>>`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE "status" IN ('OPERATIONAL', 'DEGRADED'))::bigint AS healthy,
        AVG("response_time_ms")::float AS avg_ms
      FROM "monitoring_results"
      WHERE "monitor_id" = ${monitor.id}::uuid
        AND "checked_at" >= ${since30d}
    `,
  ]);

  const m24 = metrics24h.get(monitor.id);
  const s30 = stats30d[0];
  const total30 = s30 ? Number(s30.total) : 0;
  const healthy30 = s30 ? Number(s30.healthy) : 0;

  return {
    ...monitor,
    activeIncident: monitor.incidents[0] ?? null,
    uptime24h: m24?.uptime24h ?? null,
    uptime30d: total30 > 0 ? Number(((healthy30 / total30) * 100).toFixed(2)) : null,
    avgResponseTime24h: m24?.avgResponseTime24h ?? monitor.lastResponseTimeMs ?? null,
    avgResponseTime30d: s30?.avg_ms !== null && s30?.avg_ms !== undefined ? Math.round(s30.avg_ms) : null,
  };
}

export async function updateMonitor(
  projectId: string,
  monitorId: string,
  actorId: string,
  input: UpdateMonitorInput,
  req: Request,
) {
  const existing = await prisma.monitor.findFirst({
    where: { id: monitorId, projectId },
  });
  if (!existing) throw new NotFoundError('Monitor not found');

  let normalizedUrl = existing.url;
  if (input.url !== undefined) {
    normalizedUrl = await assertSafeMonitorTarget(input.url);
  }

  let sanitizedHeaders = existing.headers as Record<string, string>;
  if (input.headers !== undefined) {
    sanitizedHeaders = assertSafeMonitorHeaders(input.headers);
  }

  const nextMethod = input.method ?? existing.method;
  const nextKeyword =
    input.keyword !== undefined ? input.keyword?.trim() || null : existing.keyword;
  const nextKeywordMatchType = nextKeyword
    ? input.keywordMatchType ?? existing.keywordMatchType ?? 'CONTAINS'
    : null;

  const updated = await prisma.monitor.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      url: normalizedUrl,
      method: nextMethod,
      headers: sanitizedHeaders as Prisma.InputJsonValue,
      body: nextMethod === 'POST' ? (input.body !== undefined ? input.body : existing.body) : null,
      ...(input.expectedStatusCodes !== undefined
        ? { expectedStatusCodes: input.expectedStatusCodes }
        : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.intervalSeconds !== undefined
        ? { intervalSeconds: input.intervalSeconds }
        : {}),
      ...(input.degradedThresholdMs !== undefined
        ? { degradedThresholdMs: input.degradedThresholdMs }
        : {}),
      ...(input.failureThreshold !== undefined
        ? { failureThreshold: input.failureThreshold }
        : {}),
      ...(input.recoveryThreshold !== undefined
        ? { recoveryThreshold: input.recoveryThreshold }
        : {}),
      keyword: nextKeyword,
      keywordMatchType: nextKeywordMatchType,
      ...(input.followRedirects !== undefined
        ? { followRedirects: input.followRedirects }
        : {}),
    },
  });

  await syncMonitorSchedule(
    updated.id,
    updated.intervalSeconds,
    updated.status !== 'PAUSED',
  );

  await recordAuditLog({
    projectId,
    actorId,
    action: 'monitor.updated',
    entityType: 'Monitor',
    entityId: updated.id,
    metadata: { name: updated.name, url: updated.url },
    req,
  });

  return updated;
}

export async function deleteMonitor(
  projectId: string,
  monitorId: string,
  actorId: string,
  req: Request,
) {
  const existing = await prisma.monitor.findFirst({
    where: { id: monitorId, projectId },
  });
  if (!existing) throw new NotFoundError('Monitor not found');

  await syncMonitorSchedule(existing.id, existing.intervalSeconds, false);
  await prisma.monitor.delete({ where: { id: existing.id } });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'monitor.deleted',
    entityType: 'Monitor',
    entityId: existing.id,
    metadata: { name: existing.name, url: existing.url },
    req,
  });
}

export async function pauseMonitor(
  projectId: string,
  monitorId: string,
  actorId: string,
  req: Request,
) {
  const existing = await prisma.monitor.findFirst({
    where: { id: monitorId, projectId },
  });
  if (!existing) throw new NotFoundError('Monitor not found');

  const updated = await prisma.monitor.update({
    where: { id: existing.id },
    data: {
      status: 'PAUSED',
      lastStatusChangeAt: new Date(),
    },
  });

  await syncMonitorSchedule(updated.id, updated.intervalSeconds, false);

  await recordAuditLog({
    projectId,
    actorId,
    action: 'monitor.paused',
    entityType: 'Monitor',
    entityId: updated.id,
    req,
  });

  return updated;
}

export async function resumeMonitor(
  projectId: string,
  monitorId: string,
  actorId: string,
  req: Request,
) {
  const existing = await prisma.monitor.findFirst({
    where: { id: monitorId, projectId },
  });
  if (!existing) throw new NotFoundError('Monitor not found');

  const updated = await prisma.monitor.update({
    where: { id: existing.id },
    data: {
      status: 'PENDING',
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastStatusChangeAt: new Date(),
    },
  });

  await syncMonitorSchedule(updated.id, updated.intervalSeconds, true);
  await enqueueImmediateMonitorCheck(updated.id, 'manual');

  await recordAuditLog({
    projectId,
    actorId,
    action: 'monitor.resumed',
    entityType: 'Monitor',
    entityId: updated.id,
    req,
  });

  return updated;
}

export async function triggerManualCheck(
  projectId: string,
  monitorId: string,
  actorId: string,
  req: Request,
) {
  const existing = await prisma.monitor.findFirst({
    where: { id: monitorId, projectId },
  });
  if (!existing) throw new NotFoundError('Monitor not found');
  if (existing.status === 'PAUSED') {
    throw new BadRequestError('Resume the monitor before triggering a check');
  }

  const jobId = await enqueueImmediateMonitorCheck(existing.id, 'manual');

  await recordAuditLog({
    projectId,
    actorId,
    action: 'monitor.check_triggered',
    entityType: 'Monitor',
    entityId: existing.id,
    req,
  });

  return { queued: true, jobId };
}

export async function getMonitorCheckResults(
  projectId: string,
  monitorId: string,
  options: { limit?: number; range?: string },
) {
  const existing = await prisma.monitor.findFirst({
    where: { id: monitorId, projectId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Monitor not found');

  const hours =
    options.range === '30d' ? 720 : options.range === '7d' ? 168 : 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const take = Math.min(Math.max(options.limit ?? 50, 1), 200);

  const results = await prisma.monitoringResult.findMany({
    where: {
      monitorId,
      checkedAt: { gte: since },
    },
    orderBy: { checkedAt: 'desc' },
    take,
  });

  return results.map((r) => ({
    ...r,
    id: r.id.toString(),
  }));
}
