import type { Request } from 'express';
import type { CreateAlertRuleInput, UpdateAlertRuleInput } from '@pulsewatch/shared';
import { prisma } from '../../config/prisma';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { recordAuditLog } from '../audit/audit.service';

export async function listAlertRules(projectId: string) {
  return prisma.alertRule.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    include: {
      monitor: {
        select: { id: true, name: true, url: true },
      },
      _count: {
        select: { notifications: true },
      },
    },
  });
}

export async function createAlertRule(
  projectId: string,
  actorId: string,
  input: CreateAlertRuleInput,
  req: Request,
) {
  if (input.monitorId) {
    const mon = await prisma.monitor.findFirst({
      where: { id: input.monitorId, projectId },
      select: { id: true },
    });
    if (!mon) {
      throw new BadRequestError('Selected monitor does not belong to this project');
    }
  }

  if (input.channels.includes('EMAIL') && (!input.recipientEmails || input.recipientEmails.length === 0)) {
    throw new BadRequestError('At least one recipient email is required when EMAIL channel is enabled');
  }

  const rule = await prisma.alertRule.create({
    data: {
      projectId,
      monitorId: input.monitorId ?? null,
      name: input.name,
      triggerType: input.triggerType,
      thresholdValue: input.thresholdValue ?? null,
      consecutiveCount: input.consecutiveCount,
      cooldownMinutes: input.cooldownMinutes,
      channels: input.channels,
      recipientEmails: input.recipientEmails.map((e) => e.toLowerCase()),
      enabled: input.enabled,
    },
    include: {
      monitor: { select: { id: true, name: true, url: true } },
    },
  });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'alert_rule.created',
    entityType: 'AlertRule',
    entityId: rule.id,
    metadata: { name: rule.name, triggerType: rule.triggerType },
    req,
  });

  return rule;
}

export async function updateAlertRule(
  projectId: string,
  ruleId: string,
  actorId: string,
  input: UpdateAlertRuleInput,
  req: Request,
) {
  const existing = await prisma.alertRule.findFirst({
    where: { id: ruleId, projectId },
  });
  if (!existing) throw new NotFoundError('Alert rule not found');

  if (input.monitorId) {
    const mon = await prisma.monitor.findFirst({
      where: { id: input.monitorId, projectId },
      select: { id: true },
    });
    if (!mon) {
      throw new BadRequestError('Selected monitor does not belong to this project');
    }
  }

  const nextChannels = input.channels ?? existing.channels;
  const nextEmails =
    input.recipientEmails !== undefined
      ? input.recipientEmails.map((e) => e.toLowerCase())
      : existing.recipientEmails;

  if (nextChannels.includes('EMAIL') && nextEmails.length === 0) {
    throw new BadRequestError('At least one recipient email is required when EMAIL channel is enabled');
  }

  const updated = await prisma.alertRule.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.monitorId !== undefined ? { monitorId: input.monitorId } : {}),
      ...(input.triggerType !== undefined ? { triggerType: input.triggerType } : {}),
      ...(input.thresholdValue !== undefined ? { thresholdValue: input.thresholdValue } : {}),
      ...(input.consecutiveCount !== undefined ? { consecutiveCount: input.consecutiveCount } : {}),
      ...(input.cooldownMinutes !== undefined ? { cooldownMinutes: input.cooldownMinutes } : {}),
      channels: nextChannels,
      recipientEmails: nextEmails,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
    include: {
      monitor: { select: { id: true, name: true, url: true } },
    },
  });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'alert_rule.updated',
    entityType: 'AlertRule',
    entityId: updated.id,
    metadata: { name: updated.name, enabled: updated.enabled },
    req,
  });

  return updated;
}

export async function deleteAlertRule(
  projectId: string,
  ruleId: string,
  actorId: string,
  req: Request,
) {
  const existing = await prisma.alertRule.findFirst({
    where: { id: ruleId, projectId },
  });
  if (!existing) throw new NotFoundError('Alert rule not found');

  await prisma.alertRule.delete({ where: { id: existing.id } });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'alert_rule.deleted',
    entityType: 'AlertRule',
    entityId: existing.id,
    req,
  });
}

export async function listUserInAppNotifications(userId: string) {
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: {
        userId,
        channel: 'IN_APP',
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
    prisma.notification.count({
      where: {
        userId,
        channel: 'IN_APP',
        readAt: null,
      },
    }),
  ]);

  return { notifications, unreadCount };
}

export async function markNotificationRead(userId: string, notificationId: string) {
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });
  if (!existing) throw new NotFoundError('Notification not found');

  return prisma.notification.update({
    where: { id: existing.id },
    data: { readAt: existing.readAt ?? new Date() },
  });
}

export async function markAllNotificationsRead(userId: string) {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function listProjectNotificationLogs(projectId: string, limit = 50) {
  return prisma.notification.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    include: {
      monitor: { select: { id: true, name: true } },
      alertRule: { select: { id: true, name: true } },
    },
  });
}
