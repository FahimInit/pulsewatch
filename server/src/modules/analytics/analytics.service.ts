import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

function parseHoursFromRange(range?: string): number {
  if (range === '30d') return 24 * 30;
  if (range === '7d') return 24 * 7;
  return 24;
}

interface PeriodAggRow {
  total_checks: bigint;
  healthy_checks: bigint;
  avg_latency: number | null;
}

export async function getProjectOverviewAnalytics(projectId: string, range?: string) {
  const hours = parseHoursFromRange(range);
  const now = new Date();
  const currentStart = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const prevStart = new Date(currentStart.getTime() - hours * 60 * 60 * 1000);

  const [
    project,
    monitorsByStatus,
    activeIncidentsCount,
    recentIncidents,
    currentAgg,
    previousAgg,
  ] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { monitorLimit: true, planTier: true },
    }),
    prisma.monitor.groupBy({
      by: ['status'],
      where: { projectId },
      _count: { _all: true },
    }),
    prisma.incident.count({
      where: { projectId, status: { not: 'RESOLVED' } },
    }),
    prisma.incident.findMany({
      where: { projectId },
      orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
      take: 5,
      include: {
        monitor: { select: { id: true, name: true, url: true } },
      },
    }),
    prisma.$queryRaw<PeriodAggRow[]>`
      SELECT
        COUNT(*)::bigint AS total_checks,
        COUNT(*) FILTER (WHERE mr."status" IN ('OPERATIONAL', 'DEGRADED'))::bigint AS healthy_checks,
        AVG(mr."response_time_ms")::float AS avg_latency
      FROM "monitoring_results" mr
      INNER JOIN "monitors" m ON m."id" = mr."monitor_id"
      WHERE m."project_id" = ${projectId}::uuid
        AND mr."checked_at" >= ${currentStart}
    `,
    prisma.$queryRaw<PeriodAggRow[]>`
      SELECT
        COUNT(*)::bigint AS total_checks,
        COUNT(*) FILTER (WHERE mr."status" IN ('OPERATIONAL', 'DEGRADED'))::bigint AS healthy_checks,
        AVG(mr."response_time_ms")::float AS avg_latency
      FROM "monitoring_results" mr
      INNER JOIN "monitors" m ON m."id" = mr."monitor_id"
      WHERE m."project_id" = ${projectId}::uuid
        AND mr."checked_at" >= ${prevStart}
        AND mr."checked_at" < ${currentStart}
    `,
  ]);

  let totalMonitors = 0;
  let activeMonitors = 0;
  for (const g of monitorsByStatus) {
    totalMonitors += g._count._all;
    if (g.status !== 'PAUSED') {
      activeMonitors += g._count._all;
    }
  }

  const cur = currentAgg[0];
  const prev = previousAgg[0];

  const curTotal = cur ? Number(cur.total_checks) : 0;
  const curHealthy = cur ? Number(cur.healthy_checks) : 0;
  const overallUptime =
    curTotal > 0 ? Number(((curHealthy / curTotal) * 100).toFixed(2)) : null;

  const prevTotal = prev ? Number(prev.total_checks) : 0;
  const prevHealthy = prev ? Number(prev.healthy_checks) : 0;
  const prevUptime =
    prevTotal > 0 ? Number(((prevHealthy / prevTotal) * 100).toFixed(2)) : null;

  const uptimeDelta =
    overallUptime !== null && prevUptime !== null
      ? Number((overallUptime - prevUptime).toFixed(2))
      : null;

  const avgResponseTimeMs =
    cur?.avg_latency !== null && cur?.avg_latency !== undefined
      ? Math.round(cur.avg_latency)
      : null;
  const prevAvgResponse =
    prev?.avg_latency !== null && prev?.avg_latency !== undefined ? prev.avg_latency : null;

  const responseTimeDeltaPct =
    avgResponseTimeMs !== null && prevAvgResponse && prevAvgResponse > 0
      ? Number((((avgResponseTimeMs - prevAvgResponse) / prevAvgResponse) * 100).toFixed(1))
      : null;

  return {
    range: range || '24h',
    overallUptime,
    uptimeDelta,
    avgResponseTimeMs,
    responseTimeDeltaPct,
    activeMonitors,
    totalMonitors,
    monitorLimit: project.monitorLimit,
    activeIncidents: activeIncidentsCount,
    recentIncidents,
  };
}

interface LatencySeriesRow {
  bucket: Date;
  avg_ms: number | null;
  p95_ms: number | null;
  min_ms: number | null;
  max_ms: number | null;
  checks: bigint;
}

export async function getResponseTimeSeries(
  projectId: string,
  options: { range?: string; monitorId?: string },
) {
  const hours = parseHoursFromRange(options.range);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const monitorFilter = options.monitorId
    ? Prisma.sql`AND mr."monitor_id" = ${options.monitorId}::uuid`
    : Prisma.empty;

  const rows =
    options.range === '30d'
      ? await prisma.$queryRaw<LatencySeriesRow[]>`
          SELECT
            date_trunc('day', mr."checked_at") AS bucket,
            AVG(mr."response_time_ms")::float AS avg_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY mr."response_time_ms")::float AS p95_ms,
            MIN(mr."response_time_ms")::int AS min_ms,
            MAX(mr."response_time_ms")::int AS max_ms,
            COUNT(*)::bigint AS checks
          FROM "monitoring_results" mr
          INNER JOIN "monitors" m ON m."id" = mr."monitor_id"
          WHERE m."project_id" = ${projectId}::uuid
            AND mr."checked_at" >= ${since}
            AND mr."response_time_ms" IS NOT NULL
            ${monitorFilter}
          GROUP BY 1
          ORDER BY 1 ASC
        `
      : await prisma.$queryRaw<LatencySeriesRow[]>`
          SELECT
            date_trunc('hour', mr."checked_at") AS bucket,
            AVG(mr."response_time_ms")::float AS avg_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY mr."response_time_ms")::float AS p95_ms,
            MIN(mr."response_time_ms")::int AS min_ms,
            MAX(mr."response_time_ms")::int AS max_ms,
            COUNT(*)::bigint AS checks
          FROM "monitoring_results" mr
          INNER JOIN "monitors" m ON m."id" = mr."monitor_id"
          WHERE m."project_id" = ${projectId}::uuid
            AND mr."checked_at" >= ${since}
            AND mr."response_time_ms" IS NOT NULL
            ${monitorFilter}
          GROUP BY 1
          ORDER BY 1 ASC
        `;

  return rows.map((r) => ({
    timestamp: r.bucket.toISOString(),
    avgMs: r.avg_ms !== null ? Math.round(r.avg_ms) : 0,
    p95Ms: r.p95_ms !== null ? Math.round(r.p95_ms) : 0,
    minMs: r.min_ms ?? 0,
    maxMs: r.max_ms ?? 0,
    checks: Number(r.checks),
  }));
}

interface DailyUptimeRow {
  day: Date;
  total_checks: bigint;
  healthy_checks: bigint;
  down_checks: bigint;
  avg_latency: number | null;
}

export async function getUptimeHistorySeries(
  projectId: string,
  options: { range?: string; monitorId?: string },
) {
  const days = options.range === '90d' ? 90 : options.range === '30d' ? 30 : 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const monitorFilter = options.monitorId
    ? Prisma.sql`AND r."monitor_id" = ${options.monitorId}::uuid`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<DailyUptimeRow[]>`
    SELECT
      r."day" AS day,
      SUM(r."total_checks")::bigint AS total_checks,
      SUM(r."up_checks" + r."degraded_checks")::bigint AS healthy_checks,
      SUM(r."down_checks")::bigint AS down_checks,
      AVG(r."avg_latency_ms")::float AS avg_latency
    FROM "monitor_daily_rollups" r
    INNER JOIN "monitors" m ON m."id" = r."monitor_id"
    WHERE m."project_id" = ${projectId}::uuid
      AND r."day" >= ${since}::date
      ${monitorFilter}
    GROUP BY r."day"
    ORDER BY r."day" ASC
  `;

  return rows.map((r) => {
    const total = Number(r.total_checks);
    const healthy = Number(r.healthy_checks);
    return {
      date: r.day.toISOString().slice(0, 10),
      uptimePct: total > 0 ? Number(((healthy / total) * 100).toFixed(2)) : 100,
      totalChecks: total,
      downChecks: Number(r.down_checks),
      avgLatencyMs: r.avg_latency !== null ? Math.round(r.avg_latency) : null,
    };
  });
}

export async function getMonitorHealthDistribution(projectId: string) {
  const groups = await prisma.monitor.groupBy({
    by: ['status'],
    where: { projectId },
    _count: { _all: true },
  });

  const base: Record<string, number> = {
    OPERATIONAL: 0,
    DEGRADED: 0,
    DOWN: 0,
    PAUSED: 0,
    PENDING: 0,
  };

  for (const g of groups) {
    base[g.status] = g._count._all;
  }

  return Object.entries(base).map(([status, count]) => ({ status, count }));
}
