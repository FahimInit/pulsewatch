import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';

export interface AuditLogParams {
  projectId?: string | null;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  req?: Request;
}

export async function recordAuditLog(params: AuditLogParams): Promise<void> {
  try {
    const ipAddress =
      params.req?.ip ||
      (typeof params.req?.headers['x-forwarded-for'] === 'string'
        ? params.req.headers['x-forwarded-for'].split(',')[0].trim()
        : null);
    const userAgent =
      typeof params.req?.headers['user-agent'] === 'string'
        ? params.req.headers['user-agent'].slice(0, 512)
        : null;

    await prisma.auditLog.create({
      data: {
        projectId: params.projectId ?? null,
        actorId: params.actorId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        metadata: params.metadata
          ? (params.metadata as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        ipAddress,
        userAgent,
      },
    });
  } catch (err) {
    logger.warn({ err, action: params.action }, 'Failed to persist audit log entry');
  }
}
