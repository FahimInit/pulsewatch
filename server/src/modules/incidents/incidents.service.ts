import type { Request } from 'express';
import type {
  Prisma,
  IncidentSeverity,
  IncidentStatus,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { recordAuditLog } from '../audit/audit.service';
import { publishServerRealtimeEvent } from '../../realtime/publisher';

export async function listProjectIncidents(
  projectId: string,
  filters: { status?: string; severity?: string; monitorId?: string },
) {
  const where: Prisma.IncidentWhereInput = { projectId };

  if (filters.status === 'ACTIVE') {
    where.status = { not: 'RESOLVED' };
  } else if (
    filters.status &&
    filters.status !== 'ALL' &&
    ['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'].includes(filters.status)
  ) {
    where.status = filters.status as IncidentStatus;
  }

  if (
    filters.severity &&
    filters.severity !== 'ALL' &&
    ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(filters.severity)
  ) {
    where.severity = filters.severity as IncidentSeverity;
  }

  if (filters.monitorId) {
    where.monitorId = filters.monitorId;
  }

  return prisma.incident.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take: 100,
    include: {
      monitor: {
        select: { id: true, name: true, url: true, status: true },
      },
      acknowledgedBy: {
        select: { id: true, name: true, email: true },
      },
      resolvedBy: {
        select: { id: true, name: true, email: true },
      },
      _count: {
        select: { events: true },
      },
    },
  });
}

export async function getIncidentById(projectId: string, incidentId: string) {
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, projectId },
    include: {
      monitor: {
        select: { id: true, name: true, url: true, status: true, lastResponseTimeMs: true },
      },
      acknowledgedBy: {
        select: { id: true, name: true, email: true },
      },
      resolvedBy: {
        select: { id: true, name: true, email: true },
      },
      events: {
        orderBy: { createdAt: 'asc' },
        include: {
          actor: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    },
  });

  if (!incident) throw new NotFoundError('Incident not found');
  return incident;
}

export async function acknowledgeIncident(
  projectId: string,
  incidentId: string,
  actor: { id: string; name: string },
  req: Request,
) {
  const existing = await prisma.incident.findFirst({
    where: { id: incidentId, projectId },
  });
  if (!existing) throw new NotFoundError('Incident not found');
  if (existing.status === 'RESOLVED') {
    throw new BadRequestError('Resolved incidents cannot be acknowledged');
  }

  const now = new Date();
  const nextStatus: IncidentStatus =
    existing.status === 'INVESTIGATING' ? 'IDENTIFIED' : existing.status;

  const updated = await prisma.incident.update({
    where: { id: existing.id },
    data: {
      acknowledgedAt: existing.acknowledgedAt ?? now,
      acknowledgedById: existing.acknowledgedById ?? actor.id,
      status: nextStatus,
      events: {
        create: {
          actorId: actor.id,
          type: 'ACKNOWLEDGED',
          message: `${actor.name} acknowledged the incident.`,
        },
      },
    },
  });

  await recordAuditLog({
    projectId,
    actorId: actor.id,
    action: 'incident.acknowledged',
    entityType: 'Incident',
    entityId: updated.id,
    req,
  });

  await publishServerRealtimeEvent({
    type: 'incident:updated',
    projectId,
    incidentId: updated.id,
    monitorId: updated.monitorId,
    status: updated.status,
    severity: updated.severity,
    title: updated.title,
    timestamp: now.toISOString(),
  });

  return getIncidentById(projectId, updated.id);
}

export async function updateIncidentStatus(
  projectId: string,
  incidentId: string,
  actor: { id: string; name: string },
  input: { status: 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING'; message?: string },
  req: Request,
) {
  const existing = await prisma.incident.findFirst({
    where: { id: incidentId, projectId },
  });
  if (!existing) throw new NotFoundError('Incident not found');
  if (existing.status === 'RESOLVED') {
    throw new BadRequestError('Cannot transition status of an already resolved incident');
  }

  const updated = await prisma.incident.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      events: {
        create: {
          actorId: actor.id,
          type: 'STATUS_CHANGED',
          message:
            input.message?.trim() ||
            `${actor.name} updated incident status from ${existing.status} to ${input.status}.`,
          metadata: { from: existing.status, to: input.status },
        },
      },
    },
  });

  await recordAuditLog({
    projectId,
    actorId: actor.id,
    action: 'incident.status_changed',
    entityType: 'Incident',
    entityId: updated.id,
    metadata: { from: existing.status, to: input.status },
    req,
  });

  await publishServerRealtimeEvent({
    type: 'incident:updated',
    projectId,
    incidentId: updated.id,
    monitorId: updated.monitorId,
    status: updated.status,
    severity: updated.severity,
    title: updated.title,
    timestamp: new Date().toISOString(),
  });

  return getIncidentById(projectId, updated.id);
}

export async function addIncidentInvestigationNote(
  projectId: string,
  incidentId: string,
  actor: { id: string; name: string },
  message: string,
  req: Request,
) {
  const existing = await prisma.incident.findFirst({
    where: { id: incidentId, projectId },
  });
  if (!existing) throw new NotFoundError('Incident not found');

  const event = await prisma.incidentEvent.create({
    data: {
      incidentId: existing.id,
      actorId: actor.id,
      type: 'INVESTIGATION_NOTE',
      message,
    },
    include: {
      actor: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  await recordAuditLog({
    projectId,
    actorId: actor.id,
    action: 'incident.note_added',
    entityType: 'Incident',
    entityId: existing.id,
    req,
  });

  await publishServerRealtimeEvent({
    type: 'incident:updated',
    projectId,
    incidentId: existing.id,
    monitorId: existing.monitorId,
    status: existing.status,
    severity: existing.severity,
    title: existing.title,
    timestamp: new Date().toISOString(),
  });

  return event;
}

export async function resolveIncidentManually(
  projectId: string,
  incidentId: string,
  actor: { id: string; name: string },
  resolutionNotes: string,
  req: Request,
) {
  const existing = await prisma.incident.findFirst({
    where: { id: incidentId, projectId },
  });
  if (!existing) throw new NotFoundError('Incident not found');
  if (existing.status === 'RESOLVED') {
    throw new BadRequestError('Incident is already resolved');
  }

  const now = new Date();
  const updated = await prisma.incident.update({
    where: { id: existing.id },
    data: {
      status: 'RESOLVED',
      resolvedAt: now,
      resolvedById: actor.id,
      resolutionNotes,
      acknowledgedAt: existing.acknowledgedAt ?? now,
      acknowledgedById: existing.acknowledgedById ?? actor.id,
      events: {
        create: {
          actorId: actor.id,
          type: 'RESOLVED',
          message: `${actor.name} resolved the incident: ${resolutionNotes}`,
        },
      },
    },
  });

  await recordAuditLog({
    projectId,
    actorId: actor.id,
    action: 'incident.resolved',
    entityType: 'Incident',
    entityId: updated.id,
    req,
  });

  await publishServerRealtimeEvent({
    type: 'incident:resolved',
    projectId,
    incidentId: updated.id,
    monitorId: updated.monitorId,
    status: 'RESOLVED',
    severity: updated.severity,
    title: updated.title,
    timestamp: now.toISOString(),
  });

  return getIncidentById(projectId, updated.id);
}
