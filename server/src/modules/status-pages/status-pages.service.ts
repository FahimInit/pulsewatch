import type { Request } from 'express';
import type {
  CreateStatusPageInput,
  UpdateStatusPageInput,
  CreateMaintenanceWindowInput,
  UpdateMaintenanceWindowInput,
} from '@pulsewatch/shared';
import { prisma } from '../../config/prisma';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors';
import { recordAuditLog } from '../audit/audit.service';

async function assertMonitorsBelongToProject(projectId: string, monitorIds: string[]) {
  if (monitorIds.length === 0) return;
  const uniqueIds = Array.from(new Set(monitorIds));
  const count = await prisma.monitor.count({
    where: {
      projectId,
      id: { in: uniqueIds },
    },
  });
  if (count !== uniqueIds.length) {
    throw new BadRequestError('One or more selected monitors do not belong to this project');
  }
}

export async function listProjectStatusPages(projectId: string) {
  return prisma.statusPage.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    include: {
      monitors: {
        orderBy: { sortOrder: 'asc' },
        include: {
          monitor: { select: { id: true, name: true, status: true } },
        },
      },
    },
  });
}

export async function createStatusPage(
  projectId: string,
  actorId: string,
  input: CreateStatusPageInput,
  req: Request,
) {
  const existingSlug = await prisma.statusPage.findUnique({ where: { slug: input.slug } });
  if (existingSlug) {
    throw new ConflictError(`Status page slug '${input.slug}' is already taken`, 'SLUG_TAKEN');
  }

  await assertMonitorsBelongToProject(
    projectId,
    input.monitors.map((m) => m.monitorId),
  );

  const page = await prisma.statusPage.create({
    data: {
      projectId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      customHeadline: input.customHeadline ?? null,
      isPublic: input.isPublic,
      showUptimeHistory: input.showUptimeHistory,
      showIncidents: input.showIncidents,
      monitors: {
        create: input.monitors.map((m, idx) => ({
          monitorId: m.monitorId,
          displayName: m.displayName,
          groupName: m.groupName ?? null,
          sortOrder: m.sortOrder ?? idx,
        })),
      },
    },
    include: {
      monitors: {
        orderBy: { sortOrder: 'asc' },
        include: { monitor: { select: { id: true, name: true, status: true } } },
      },
    },
  });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'status_page.created',
    entityType: 'StatusPage',
    entityId: page.id,
    metadata: { slug: page.slug },
    req,
  });

  return page;
}

export async function updateStatusPage(
  projectId: string,
  pageId: string,
  actorId: string,
  input: UpdateStatusPageInput,
  req: Request,
) {
  const existing = await prisma.statusPage.findFirst({
    where: { id: pageId, projectId },
  });
  if (!existing) throw new NotFoundError('Status page not found');

  if (input.slug && input.slug !== existing.slug) {
    const slugTaken = await prisma.statusPage.findUnique({ where: { slug: input.slug } });
    if (slugTaken) {
      throw new ConflictError(`Status page slug '${input.slug}' is already taken`, 'SLUG_TAKEN');
    }
  }

  if (input.monitors) {
    await assertMonitorsBelongToProject(
      projectId,
      input.monitors.map((m) => m.monitorId),
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.monitors !== undefined) {
      await tx.statusPageMonitor.deleteMany({ where: { statusPageId: existing.id } });
    }

    return tx.statusPage.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.customHeadline !== undefined ? { customHeadline: input.customHeadline } : {}),
        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        ...(input.showUptimeHistory !== undefined
          ? { showUptimeHistory: input.showUptimeHistory }
          : {}),
        ...(input.showIncidents !== undefined ? { showIncidents: input.showIncidents } : {}),
        ...(input.monitors !== undefined
          ? {
              monitors: {
                create: input.monitors.map((m, idx) => ({
                  monitorId: m.monitorId,
                  displayName: m.displayName,
                  groupName: m.groupName ?? null,
                  sortOrder: m.sortOrder ?? idx,
                })),
              },
            }
          : {}),
      },
      include: {
        monitors: {
          orderBy: { sortOrder: 'asc' },
          include: { monitor: { select: { id: true, name: true, status: true } } },
        },
      },
    });
  });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'status_page.updated',
    entityType: 'StatusPage',
    entityId: updated.id,
    req,
  });

  return updated;
}

export async function deleteStatusPage(
  projectId: string,
  pageId: string,
  actorId: string,
  req: Request,
) {
  const existing = await prisma.statusPage.findFirst({
    where: { id: pageId, projectId },
  });
  if (!existing) throw new NotFoundError('Status page not found');

  await prisma.statusPage.delete({ where: { id: existing.id } });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'status_page.deleted',
    entityType: 'StatusPage',
    entityId: existing.id,
    req,
  });
}

// =============================================================================
// Maintenance Windows
// =============================================================================
export async function listMaintenanceWindows(projectId: string) {
  return prisma.maintenanceWindow.findMany({
    where: { projectId },
    orderBy: { startsAt: 'desc' },
    include: {
      statusPage: { select: { id: true, name: true, slug: true } },
      monitors: { select: { id: true, name: true } },
    },
  });
}

export async function createMaintenanceWindow(
  projectId: string,
  actorId: string,
  input: CreateMaintenanceWindowInput,
  req: Request,
) {
  await assertMonitorsBelongToProject(projectId, input.monitorIds);

  if (input.statusPageId) {
    const sp = await prisma.statusPage.findFirst({
      where: { id: input.statusPageId, projectId },
    });
    if (!sp) throw new BadRequestError('Selected status page does not belong to this project');
  }

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  const now = new Date();
  const initialStatus =
    startsAt <= now && endsAt > now ? 'IN_PROGRESS' : 'SCHEDULED';

  const mw = await prisma.maintenanceWindow.create({
    data: {
      projectId,
      statusPageId: input.statusPageId ?? null,
      title: input.title,
      description: input.description ?? null,
      startsAt,
      endsAt,
      status: initialStatus,
      suppressAlerts: input.suppressAlerts,
      createdById: actorId,
      monitors: {
        connect: input.monitorIds.map((id) => ({ id })),
      },
    },
    include: {
      statusPage: { select: { id: true, name: true, slug: true } },
      monitors: { select: { id: true, name: true } },
    },
  });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'maintenance.created',
    entityType: 'MaintenanceWindow',
    entityId: mw.id,
    metadata: { title: mw.title },
    req,
  });

  return mw;
}

export async function updateMaintenanceWindow(
  projectId: string,
  windowId: string,
  actorId: string,
  input: UpdateMaintenanceWindowInput,
  req: Request,
) {
  const existing = await prisma.maintenanceWindow.findFirst({
    where: { id: windowId, projectId },
  });
  if (!existing) throw new NotFoundError('Maintenance window not found');

  if (input.monitorIds) {
    await assertMonitorsBelongToProject(projectId, input.monitorIds);
  }

  const updated = await prisma.maintenanceWindow.update({
    where: { id: existing.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.statusPageId !== undefined ? { statusPageId: input.statusPageId } : {}),
      ...(input.startsAt !== undefined ? { startsAt: new Date(input.startsAt) } : {}),
      ...(input.endsAt !== undefined ? { endsAt: new Date(input.endsAt) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.suppressAlerts !== undefined ? { suppressAlerts: input.suppressAlerts } : {}),
      ...(input.monitorIds !== undefined
        ? {
            monitors: {
              set: input.monitorIds.map((id) => ({ id })),
            },
          }
        : {}),
    },
    include: {
      statusPage: { select: { id: true, name: true, slug: true } },
      monitors: { select: { id: true, name: true } },
    },
  });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'maintenance.updated',
    entityType: 'MaintenanceWindow',
    entityId: updated.id,
    req,
  });

  return updated;
}

export async function deleteMaintenanceWindow(
  projectId: string,
  windowId: string,
  actorId: string,
  req: Request,
) {
  const existing = await prisma.maintenanceWindow.findFirst({
    where: { id: windowId, projectId },
  });
  if (!existing) throw new NotFoundError('Maintenance window not found');

  await prisma.maintenanceWindow.delete({ where: { id: existing.id } });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'maintenance.deleted',
    entityType: 'MaintenanceWindow',
    entityId: existing.id,
    req,
  });
}

// =============================================================================
// Public Status Page Resolver (Strictly Sanitized DTO — Zero Private Leaks)
// =============================================================================
export async function getPublicStatusPageBySlug(slug: string) {
  const page = await prisma.statusPage.findUnique({
    where: { slug },
    include: {
      monitors: {
        orderBy: { sortOrder: 'asc' },
        include: {
          monitor: {
            select: {
              id: true,
              status: true,
              lastCheckedAt: true,
              lastResponseTimeMs: true,
            },
          },
        },
      },
    },
  });

  if (!page || !page.isPublic) {
    throw new NotFoundError('Public status page not found');
  }

  const monitorIds = page.monitors.map((pm) => pm.monitorId);
  const now = new Date();
  const since90d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 89));
  const since14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [rollups, incidents, maintenances] = await Promise.all([
    page.showUptimeHistory && monitorIds.length > 0
      ? prisma.monitorDailyRollup.findMany({
          where: {
            monitorId: { in: monitorIds },
            day: { gte: since90d },
          },
          orderBy: { day: 'asc' },
        })
      : Promise.resolve([]),
    page.showIncidents && monitorIds.length > 0
      ? prisma.incident.findMany({
          where: {
            projectId: page.projectId,
            monitorId: { in: monitorIds },
            OR: [{ status: { not: 'RESOLVED' } }, { startedAt: { gte: since14d } }],
          },
          orderBy: { startedAt: 'desc' },
          take: 25,
          select: {
            id: true,
            monitorId: true,
            title: true,
            summary: true,
            severity: true,
            status: true,
            startedAt: true,
            resolvedAt: true,
            resolutionNotes: true,
            events: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                type: true,
                message: true,
                createdAt: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.maintenanceWindow.findMany({
      where: {
        projectId: page.projectId,
        OR: [{ statusPageId: page.id }, { statusPageId: null }],
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        endsAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        startsAt: true,
        endsAt: true,
        status: true,
      },
    }),
  ]);

  // Group rollups by monitorId -> YYYY-MM-DD
  const rollupByMonitor = new Map<
    string,
    Map<string, { total: number; healthy: number; down: number }>
  >();
  for (const r of rollups) {
    const dateKey = r.day.toISOString().slice(0, 10);
    if (!rollupByMonitor.has(r.monitorId)) {
      rollupByMonitor.set(r.monitorId, new Map());
    }
    rollupByMonitor.get(r.monitorId)!.set(dateKey, {
      total: r.totalChecks,
      healthy: r.upChecks + r.degradedChecks,
      down: r.downChecks,
    });
  }

  // Generate 90 calendar day keys
  const dayKeys: string[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    dayKeys.push(d.toISOString().slice(0, 10));
  }

  const displayNameByMonitor = new Map(page.monitors.map((m) => [m.monitorId, m.displayName]));

  const services = page.monitors.map((pm) => {
    const monRollups = rollupByMonitor.get(pm.monitorId);
    let sumTotal = 0;
    let sumHealthy = 0;

    const dailyBars = page.showUptimeHistory
      ? dayKeys.map((date) => {
          const entry = monRollups?.get(date);
          if (!entry || entry.total === 0) {
            return { date, status: 'NO_DATA' as const, uptimePct: null };
          }
          sumTotal += entry.total;
          sumHealthy += entry.healthy;
          const pct = Number(((entry.healthy / entry.total) * 100).toFixed(2));
          const barStatus =
            pct === 100
              ? ('OPERATIONAL' as const)
              : pct >= 98
                ? ('DEGRADED' as const)
                : ('DOWN' as const);
          return { date, status: barStatus, uptimePct: pct };
        })
      : [];

    return {
      id: pm.monitor.id,
      displayName: pm.displayName,
      groupName: pm.groupName || 'Services',
      status: pm.monitor.status,
      lastCheckedAt: pm.monitor.lastCheckedAt,
      lastResponseTimeMs: pm.monitor.lastResponseTimeMs,
      uptime90d:
        sumTotal > 0 ? Number(((sumHealthy / sumTotal) * 100).toFixed(2)) : null,
      dailyBars,
    };
  });

  const hasDown = services.some((s) => s.status === 'DOWN');
  const hasDegraded = services.some((s) => s.status === 'DEGRADED');
  const hasActiveMaint = maintenances.some(
    (m) => m.status === 'IN_PROGRESS' || (m.startsAt <= now && m.endsAt >= now),
  );

  const overallBannerStatus = hasDown
    ? 'MAJOR_OUTAGE'
    : hasDegraded
      ? 'PARTIAL_DEGRADATION'
      : hasActiveMaint
        ? 'UNDER_MAINTENANCE'
        : 'ALL_OPERATIONAL';

  return {
    statusPage: {
      name: page.name,
      slug: page.slug,
      description: page.description,
      customHeadline: page.customHeadline,
      showUptimeHistory: page.showUptimeHistory,
      showIncidents: page.showIncidents,
      overallStatus: overallBannerStatus,
      generatedAt: now.toISOString(),
    },
    services,
    maintenanceWindows: maintenances,
    incidents: incidents.map((inc) => ({
      ...inc,
      serviceName: displayNameByMonitor.get(inc.monitorId) || 'Service',
    })),
  };
}
