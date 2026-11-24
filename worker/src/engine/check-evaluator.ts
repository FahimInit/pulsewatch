import crypto from 'node:crypto';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  type NotificationDispatchJobPayload,
  type MonitorStatus,
  type NotificationType,
} from '@pulsewatch/shared';
import type { IncidentSeverity, IncidentTriggerReason } from '@prisma/client';
import { workerPrisma, workerLogger, createWorkerRedisConnection } from '../config';
import {
  executeHttpHealthCheck,
  type CustomLookupResolver,
  type HttpCheckOutcome,
} from '../checker/http-checker';
import { publishRealtimeEvent } from '../events/publisher';

let lockRedis: Redis | null = null;
let lockRedisUrl: string | null = null;
let notificationQueue: Queue<NotificationDispatchJobPayload> | null = null;
let notificationQueueUrl: string | null = null;

function getLockRedis(): Redis {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  if (!lockRedis || lockRedisUrl !== url) {
    if (lockRedis) lockRedis.disconnect();
    lockRedisUrl = url;
    lockRedis = new Redis(url, { maxRetriesPerRequest: 3 });
  }
  return lockRedis;
}

export function getWorkerNotificationQueue(): Queue<NotificationDispatchJobPayload> {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  if (!notificationQueue || notificationQueueUrl !== url) {
    notificationQueueUrl = url;
    notificationQueue = new Queue<NotificationDispatchJobPayload>(
      QUEUE_NAMES.NOTIFICATION_DISPATCH,
      {
        connection: createWorkerRedisConnection(),
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: 200,
          removeOnFail: 500,
        },
      },
    );
  }
  return notificationQueue;
}

export async function closeEvaluatorConnections(): Promise<void> {
  if (notificationQueue) {
    await notificationQueue.close().catch(() => {});
    notificationQueue = null;
  }
  if (lockRedis) {
    await lockRedis.quit().catch(() => lockRedis?.disconnect());
    lockRedis = null;
  }
}

const RELEASE_LOCK_LUA = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

export interface EvaluateMonitorOptions {
  allowPrivateTargets?: boolean;
  customLookup?: CustomLookupResolver;
}

export interface EvaluationSummary {
  skipped: boolean;
  reason?: string;
  outcome?: HttpCheckOutcome;
  previousStatus?: MonitorStatus;
  currentStatus?: MonitorStatus;
  incidentCreatedId?: string | null;
  incidentResolvedId?: string | null;
  notificationsCreated?: number;
}

export async function runMonitorCheckAndEvaluate(
  monitorId: string,
  options: EvaluateMonitorOptions = {},
): Promise<EvaluationSummary> {
  const redis = getLockRedis();
  const lockKey = `lock:monitor:${monitorId}`;
  const lockToken = crypto.randomUUID();

  const monitor = await workerPrisma.monitor.findUnique({
    where: { id: monitorId },
    include: {
      maintenanceWindows: {
        where: {
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          startsAt: { lte: new Date() },
          endsAt: { gte: new Date() },
        },
      },
    },
  });

  if (!monitor || monitor.status === 'PAUSED') {
    return { skipped: true, reason: !monitor ? 'not_found' : 'paused' };
  }

  const lockTtlMs = monitor.timeoutMs + 8000;
  const acquired = await redis.set(lockKey, lockToken, 'PX', lockTtlMs, 'NX');
  if (!acquired) {
    return { skipped: true, reason: 'already_in_flight' };
  }

  try {
    const now = new Date();
    const isAlertsSuppressed = monitor.maintenanceWindows.some((w) => w.suppressAlerts);

    // Execute outbound HTTP/HTTPS health check
    const outcome = await executeHttpHealthCheck({
      url: monitor.url,
      method: monitor.method,
      headers: (monitor.headers as Record<string, string>) || {},
      body: monitor.body,
      expectedStatusCodes: monitor.expectedStatusCodes,
      timeoutMs: monitor.timeoutMs,
      degradedThresholdMs: monitor.degradedThresholdMs,
      keyword: monitor.keyword,
      keywordMatchType: monitor.keywordMatchType,
      followRedirects: monitor.followRedirects,
      allowPrivateTargets: options.allowPrivateTargets,
      customLookup: options.customLookup,
    });

    const checkedAt = new Date();
    const dayBucket = new Date(
      Date.UTC(checkedAt.getUTCFullYear(), checkedAt.getUTCMonth(), checkedAt.getUTCDate()),
    );

    const txResult = await workerPrisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: string;
          status: MonitorStatus;
          consecutive_failures: number;
          consecutive_successes: number;
        }>
      >`
        SELECT "id", "status", "consecutive_failures", "consecutive_successes"
        FROM "monitors"
        WHERE "id" = ${monitor.id}::uuid
        FOR UPDATE
      `;

      if (lockedRows.length === 0 || lockedRows[0].status === 'PAUSED') {
        return null;
      }

      const prev = lockedRows[0];

      // 1. Insert append-only MonitoringResult
      await tx.monitoringResult.create({
        data: {
          monitorId: monitor.id,
          checkedAt,
          status: outcome.status,
          statusCode: outcome.statusCode,
          responseTimeMs: outcome.responseTimeMs,
          dnsTimeMs: outcome.dnsTimeMs,
          connectTimeMs: outcome.connectTimeMs,
          ttfbMs: outcome.ttfbMs,
          responseSizeBytes: outcome.responseSizeBytes,
          keywordMatched: outcome.keywordMatched,
          errorType: outcome.errorType,
          errorMessage: outcome.errorMessage,
          resolvedIp: outcome.resolvedIp,
        },
      });

      // 2. Upsert daily rollup for sub-5ms 90-day uptime & analytics
      const upInc = outcome.status === 'OPERATIONAL' ? 1 : 0;
      const degInc = outcome.status === 'DEGRADED' ? 1 : 0;
      const downInc = outcome.status === 'DOWN' ? 1 : 0;
      const lat = outcome.responseTimeMs;

      await tx.$executeRaw`
        INSERT INTO "monitor_daily_rollups" (
          "monitor_id", "day", "total_checks", "up_checks", "degraded_checks", "down_checks",
          "avg_latency_ms", "min_latency_ms", "max_latency_ms", "updated_at"
        )
        VALUES (
          ${monitor.id}::uuid, ${dayBucket}::date, 1, ${upInc}, ${degInc}, ${downInc},
          ${lat}, ${lat}, ${lat}, ${checkedAt}
        )
        ON CONFLICT ("monitor_id", "day") DO UPDATE SET
          "total_checks" = "monitor_daily_rollups"."total_checks" + 1,
          "up_checks" = "monitor_daily_rollups"."up_checks" + ${upInc},
          "degraded_checks" = "monitor_daily_rollups"."degraded_checks" + ${degInc},
          "down_checks" = "monitor_daily_rollups"."down_checks" + ${downInc},
          "avg_latency_ms" = CASE
            WHEN ${lat}::double precision IS NULL THEN "monitor_daily_rollups"."avg_latency_ms"
            WHEN "monitor_daily_rollups"."avg_latency_ms" IS NULL THEN ${lat}::double precision
            ELSE (
              ("monitor_daily_rollups"."avg_latency_ms" * "monitor_daily_rollups"."total_checks") + ${lat}::double precision
            ) / ("monitor_daily_rollups"."total_checks" + 1)
          END,
          "min_latency_ms" = CASE
            WHEN ${lat}::integer IS NULL THEN "monitor_daily_rollups"."min_latency_ms"
            WHEN "monitor_daily_rollups"."min_latency_ms" IS NULL THEN ${lat}::integer
            ELSE LEAST("monitor_daily_rollups"."min_latency_ms", ${lat}::integer)
          END,
          "max_latency_ms" = CASE
            WHEN ${lat}::integer IS NULL THEN "monitor_daily_rollups"."max_latency_ms"
            WHEN "monitor_daily_rollups"."max_latency_ms" IS NULL THEN ${lat}::integer
            ELSE GREATEST("monitor_daily_rollups"."max_latency_ms", ${lat}::integer)
          END,
          "updated_at" = ${checkedAt}
      `;

      // 3. Evaluate Monitor status & Incident state machine
      let nextFailures = prev.consecutive_failures;
      let nextSuccesses = prev.consecutive_successes;
      let nextStatus: MonitorStatus = prev.status;

      const openIncident = await tx.incident.findFirst({
        where: {
          monitorId: monitor.id,
          status: { not: 'RESOLVED' },
        },
      });

      let createdIncident: {
        id: string;
        title: string;
        severity: IncidentSeverity;
        status: 'INVESTIGATING';
      } | null = null;

      let resolvedIncident: {
        id: string;
        title: string;
        severity: IncidentSeverity;
        status: 'RESOLVED';
      } | null = null;

      if (outcome.status === 'DOWN') {
        nextFailures += 1;
        nextSuccesses = 0;

        if (nextFailures >= monitor.failureThreshold) {
          nextStatus = 'DOWN';

          if (!openIncident && !isAlertsSuppressed) {
            const triggerReason: IncidentTriggerReason =
              outcome.errorType === 'TIMEOUT'
                ? 'TIMEOUT'
                : outcome.errorType === 'KEYWORD_MISMATCH'
                  ? 'KEYWORD_FAILURE'
                  : 'STATUS_DOWN';

            const severity: IncidentSeverity =
              outcome.errorType === 'TIMEOUT' || outcome.errorType === 'CONNECTION_REFUSED'
                ? 'CRITICAL'
                : 'HIGH';

            const title =
              outcome.errorType === 'TIMEOUT'
                ? `${monitor.name} Request Timeout`
                : outcome.errorType === 'KEYWORD_MISMATCH'
                  ? `${monitor.name} Keyword Validation Failed`
                  : `${monitor.name} Endpoint Unreachable`;

            const summary =
              outcome.errorMessage ||
              `Endpoint failed ${nextFailures} consecutive health checks.`;

            const inc = await tx.incident.create({
              data: {
                projectId: monitor.projectId,
                monitorId: monitor.id,
                title,
                summary,
                severity,
                status: 'INVESTIGATING',
                triggerReason,
                startedAt: checkedAt,
                events: {
                  create: {
                    type: 'DETECTED',
                    message: `Incident automatically opened after ${nextFailures} consecutive failed checks (${summary}).`,
                    metadata: {
                      statusCode: outcome.statusCode,
                      errorType: outcome.errorType,
                      responseTimeMs: outcome.responseTimeMs,
                    },
                  },
                },
              },
            });

            createdIncident = {
              id: inc.id,
              title: inc.title,
              severity: inc.severity,
              status: 'INVESTIGATING',
            };
          }
        } else if (prev.status === 'PENDING') {
          nextStatus = 'DEGRADED';
        }
      } else {
        // Check passed (OPERATIONAL or DEGRADED)
        nextFailures = 0;
        nextSuccesses += 1;

        if (openIncident) {
          if (nextSuccesses >= monitor.recoveryThreshold) {
            nextStatus = outcome.status;
            const resolved = await tx.incident.update({
              where: { id: openIncident.id },
              data: {
                status: 'RESOLVED',
                resolvedAt: checkedAt,
                resolutionNotes:
                  openIncident.resolutionNotes ||
                  `Automatically resolved after ${nextSuccesses} consecutive healthy checks (${outcome.responseTimeMs} ms).`,
                events: {
                  create: [
                    {
                      type: 'RECOVERY_DETECTED',
                      message: `Endpoint responded healthy (${outcome.statusCode}, ${outcome.responseTimeMs} ms) for ${nextSuccesses} consecutive checks.`,
                    },
                    {
                      type: 'RESOLVED',
                      message: 'Incident automatically marked as Resolved.',
                    },
                  ],
                },
              },
            });

            resolvedIncident = {
              id: resolved.id,
              title: resolved.title,
              severity: resolved.severity,
              status: 'RESOLVED',
            };
          } else {
            // Keep monitor DOWN until recoveryThreshold consecutive checks succeed
            nextStatus = 'DOWN';
          }
        } else {
          nextStatus = outcome.status;
        }
      }

      const statusChanged = prev.status !== nextStatus;

      await tx.monitor.update({
        where: { id: monitor.id },
        data: {
          status: nextStatus,
          consecutiveFailures: nextFailures,
          consecutiveSuccesses: nextSuccesses,
          lastCheckedAt: checkedAt,
          lastResponseTimeMs: outcome.responseTimeMs,
          ...(statusChanged ? { lastStatusChangeAt: checkedAt } : {}),
        },
      });

      // 4. Evaluate AlertRules & persist Notifications when not suppressed
      const createdInAppNotifications: Array<{
        id: string;
        userId: string;
        title: string;
        body: string;
        type: NotificationType;
        createdAt: Date;
      }> = [];
      const createdEmailNotificationIds: string[] = [];

      if (!isAlertsSuppressed) {
        const rules = await tx.alertRule.findMany({
          where: {
            projectId: monitor.projectId,
            enabled: true,
            OR: [{ monitorId: null }, { monitorId: monitor.id }],
          },
        });

        const members = await tx.projectMember.findMany({
          where: { projectId: monitor.projectId },
          select: { userId: true },
        });

        for (const rule of rules) {
          const cooldownMs = rule.cooldownMinutes * 60 * 1000;
          const withinCooldown =
            rule.lastTriggeredAt !== null &&
            now.getTime() - rule.lastTriggeredAt.getTime() < cooldownMs;

          let matched = false;
          let notifType: NotificationType = 'MONITOR_DOWN';
          let notifTitle = '';
          let notifBody = '';
          let eventRefKey = '';

          if (
            (rule.triggerType === 'INCIDENT_CREATED' || rule.triggerType === 'MONITOR_DOWN') &&
            (createdIncident || (statusChanged && nextStatus === 'DOWN'))
          ) {
            if (!withinCooldown) {
              matched = true;
              notifType = createdIncident ? 'INCIDENT_OPENED' : 'MONITOR_DOWN';
              notifTitle = `[DOWN] ${monitor.name} is unreachable`;
              notifBody = `${monitor.url} failed health check (${outcome.errorMessage || outcome.statusCode || 'DOWN'}).`;
              eventRefKey = createdIncident?.id || `down-${checkedAt.getTime()}`;
            }
          } else if (
            (rule.triggerType === 'INCIDENT_RESOLVED' || rule.triggerType === 'MONITOR_RECOVERED') &&
            (resolvedIncident || (statusChanged && prev.status === 'DOWN' && nextStatus !== 'DOWN'))
          ) {
            matched = true;
            notifType = resolvedIncident ? 'INCIDENT_RESOLVED' : 'MONITOR_RECOVERY';
            notifTitle = `[RECOVERED] ${monitor.name} is back online`;
            notifBody = `${monitor.url} recovered (${outcome.statusCode}, ${outcome.responseTimeMs} ms).`;
            eventRefKey = resolvedIncident?.id || `rec-${checkedAt.getTime()}`;
          } else if (
            rule.triggerType === 'HIGH_LATENCY' &&
            outcome.status !== 'DOWN' &&
            outcome.responseTimeMs !== null &&
            outcome.responseTimeMs >= (rule.thresholdValue ?? monitor.degradedThresholdMs)
          ) {
            if (!withinCooldown) {
              matched = true;
              notifType = 'HIGH_LATENCY';
              notifTitle = `[HIGH LATENCY] ${monitor.name} responded in ${outcome.responseTimeMs} ms`;
              notifBody = `${monitor.url} exceeded latency threshold of ${rule.thresholdValue ?? monitor.degradedThresholdMs} ms.`;
              eventRefKey = `lat-${Math.floor(checkedAt.getTime() / 60000)}`;
            }
          }

          if (!matched) continue;

          await tx.alertRule.update({
            where: { id: rule.id },
            data: { lastTriggeredAt: checkedAt },
          });

          const activeIncId = createdIncident?.id ?? resolvedIncident?.id ?? openIncident?.id ?? null;

          if (rule.channels.includes('IN_APP')) {
            for (const member of members) {
              const dedupeKey = `inapp:${rule.id}:${member.userId}:${eventRefKey}`;
              const existing = await tx.notification.findUnique({ where: { dedupeKey } });
              if (!existing) {
                const n = await tx.notification.create({
                  data: {
                    projectId: monitor.projectId,
                    userId: member.userId,
                    incidentId: activeIncId,
                    monitorId: monitor.id,
                    alertRuleId: rule.id,
                    channel: 'IN_APP',
                    type: notifType,
                    title: notifTitle,
                    body: notifBody,
                    deliveryStatus: 'SENT',
                    sentAt: checkedAt,
                    dedupeKey,
                  },
                });
                createdInAppNotifications.push({
                  id: n.id,
                  userId: member.userId,
                  title: n.title,
                  body: n.body,
                  type: notifType,
                  createdAt: n.createdAt,
                });
              }
            }
          }

          if (rule.channels.includes('EMAIL') && rule.recipientEmails.length > 0) {
            for (const email of rule.recipientEmails) {
              const dedupeKey = `email:${rule.id}:${email.toLowerCase()}:${eventRefKey}`;
              const existing = await tx.notification.findUnique({ where: { dedupeKey } });
              if (!existing) {
                const emailRow = await tx.notification.create({
                  data: {
                    projectId: monitor.projectId,
                    incidentId: activeIncId,
                    monitorId: monitor.id,
                    alertRuleId: rule.id,
                    channel: 'EMAIL',
                    type: notifType,
                    title: notifTitle,
                    body: notifBody,
                    recipientEmail: email.toLowerCase(),
                    deliveryStatus: 'PENDING',
                    dedupeKey,
                  },
                });
                createdEmailNotificationIds.push(emailRow.id);
              }
            }
          }
        }
      }

      return {
        previousStatus: prev.status,
        currentStatus: nextStatus,
        statusChanged,
        createdIncident,
        resolvedIncident,
        createdInAppNotifications,
        createdEmailNotificationIds,
        checkedAt,
      };
    });

    if (!txResult) {
      return { skipped: true, reason: 'paused_during_check' };
    }

    // 5. Enqueue async SMTP dispatch outside DB transaction
    if (txResult.createdEmailNotificationIds.length > 0) {
      await getWorkerNotificationQueue().add('send-emails', {
        projectId: monitor.projectId,
        notificationIds: txResult.createdEmailNotificationIds,
      });
    }

    // 6. Publish real-time Socket.IO events via Redis Pub/Sub
    await publishRealtimeEvent({
      type: 'monitor:checked',
      projectId: monitor.projectId,
      monitorId: monitor.id,
      status: txResult.currentStatus,
      responseTimeMs: outcome.responseTimeMs,
      statusCode: outcome.statusCode,
      checkedAt: txResult.checkedAt.toISOString(),
    });

    if (txResult.statusChanged) {
      await publishRealtimeEvent({
        type: 'monitor:status_changed',
        projectId: monitor.projectId,
        monitorId: monitor.id,
        previousStatus: txResult.previousStatus,
        currentStatus: txResult.currentStatus,
        checkedAt: txResult.checkedAt.toISOString(),
      });
    }

    if (txResult.createdIncident) {
      await publishRealtimeEvent({
        type: 'incident:created',
        projectId: monitor.projectId,
        incidentId: txResult.createdIncident.id,
        monitorId: monitor.id,
        status: txResult.createdIncident.status,
        severity: txResult.createdIncident.severity,
        title: txResult.createdIncident.title,
        timestamp: txResult.checkedAt.toISOString(),
      });
    }

    if (txResult.resolvedIncident) {
      await publishRealtimeEvent({
        type: 'incident:resolved',
        projectId: monitor.projectId,
        incidentId: txResult.resolvedIncident.id,
        monitorId: monitor.id,
        status: 'RESOLVED',
        severity: txResult.resolvedIncident.severity,
        title: txResult.resolvedIncident.title,
        timestamp: txResult.checkedAt.toISOString(),
      });
    }

    for (const inApp of txResult.createdInAppNotifications) {
      await publishRealtimeEvent({
        type: 'notification:new',
        userId: inApp.userId,
        projectId: monitor.projectId,
        notificationId: inApp.id,
        title: inApp.title,
        body: inApp.body,
        notificationType: inApp.type,
        createdAt: inApp.createdAt.toISOString(),
      });
    }

    return {
      skipped: false,
      outcome,
      previousStatus: txResult.previousStatus,
      currentStatus: txResult.currentStatus,
      incidentCreatedId: txResult.createdIncident?.id ?? null,
      incidentResolvedId: txResult.resolvedIncident?.id ?? null,
      notificationsCreated:
        txResult.createdInAppNotifications.length + txResult.createdEmailNotificationIds.length,
    };
  } finally {
    await redis.eval(RELEASE_LOCK_LUA, 1, lockKey, lockToken).catch((err) => {
      workerLogger.warn({ err, monitorId }, 'Failed to release monitor lock');
    });
  }
}
