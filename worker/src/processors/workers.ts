import { Worker, type Job } from 'bullmq';
import {
  QUEUE_NAMES,
  type MonitorCheckJobPayload,
  type NotificationDispatchJobPayload,
} from '@pulsewatch/shared';
import {
  createWorkerRedisConnection,
  workerLogger,
  workerPrisma,
} from '../config';
import { runMonitorCheckAndEvaluate } from '../engine/check-evaluator';
import { sendAlertEmail, renderAlertEmailHtml } from '../notifications/mailer';

export function startMonitorCheckWorker(): Worker<MonitorCheckJobPayload> {
  const concurrency = Number(process.env.WORKER_CONCURRENCY || 25);

  const worker = new Worker<MonitorCheckJobPayload>(
    QUEUE_NAMES.MONITOR_CHECK,
    async (job: Job<MonitorCheckJobPayload>) => {
      const { monitorId } = job.data;
      return runMonitorCheckAndEvaluate(monitorId);
    },
    {
      connection: createWorkerRedisConnection(),
      concurrency,
      lockDuration: 45_000,
      stalledInterval: 15_000,
      maxStalledCount: 2,
    },
  );

  worker.on('failed', (job, err) => {
    workerLogger.error(
      { jobId: job?.id, monitorId: job?.data?.monitorId, err },
      'Monitor check job failed due to internal error',
    );
  });

  return worker;
}

export function startNotificationDispatchWorker(): Worker<NotificationDispatchJobPayload> {
  const concurrency = Number(process.env.NOTIFICATION_CONCURRENCY || 10);
  const publicUrl = process.env.PUBLIC_APP_URL || 'http://localhost:5173';

  const worker = new Worker<NotificationDispatchJobPayload>(
    QUEUE_NAMES.NOTIFICATION_DISPATCH,
    async (job: Job<NotificationDispatchJobPayload>) => {
      const { notificationIds } = job.data;
      const pendingRows = await workerPrisma.notification.findMany({
        where: {
          id: { in: notificationIds },
          channel: 'EMAIL',
          deliveryStatus: { not: 'SENT' },
        },
      });

      for (const n of pendingRows) {
        if (!n.recipientEmail) continue;

        const severityColor =
          n.type === 'MONITOR_RECOVERY' || n.type === 'INCIDENT_RESOLVED'
            ? '#16a477'
            : n.type === 'HIGH_LATENCY'
              ? '#e69b40'
              : '#e65362';

        try {
          await sendAlertEmail({
            to: n.recipientEmail,
            subject: n.title,
            text: `${n.title}\n\n${n.body}\n\nDashboard: ${publicUrl}`,
            html: renderAlertEmailHtml({
              title: n.title,
              body: n.body,
              severityColor,
              ctaUrl: n.incidentId ? `${publicUrl}/incidents/${n.incidentId}` : publicUrl,
            }),
          });

          await workerPrisma.notification.update({
            where: { id: n.id },
            data: {
              deliveryStatus: 'SENT',
              sentAt: new Date(),
              errorMessage: null,
            },
          });
        } catch (err) {
          await workerPrisma.notification.update({
            where: { id: n.id },
            data: {
              deliveryStatus: 'FAILED',
              errorMessage: err instanceof Error ? err.message.slice(0, 300) : 'SMTP error',
            },
          });
          throw err;
        }
      }
    },
    {
      connection: createWorkerRedisConnection(),
      concurrency,
    },
  );

  worker.on('failed', (job, err) => {
    workerLogger.warn({ jobId: job?.id, err }, 'Notification dispatch attempt failed');
  });

  return worker;
}
