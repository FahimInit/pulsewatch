import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  type MonitorCheckJobPayload,
} from '@pulsewatch/shared';
import { createRedisConnection } from '../config/redis';
import { logger } from '../config/logger';

let monitorQueue: Queue<MonitorCheckJobPayload> | null = null;

export function getMonitorQueue(): Queue<MonitorCheckJobPayload> {
  if (!monitorQueue) {
    monitorQueue = new Queue<MonitorCheckJobPayload>(QUEUE_NAMES.MONITOR_CHECK, {
      connection: createRedisConnection({ forBullMq: true }),
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }
  return monitorQueue;
}

export function getMonitorSchedulerId(monitorId: string): string {
  return `monitor:${monitorId}`;
}

export async function syncMonitorSchedule(
  monitorId: string,
  intervalSeconds: number,
  enabled: boolean,
): Promise<void> {
  const queue = getMonitorQueue();
  const schedulerId = getMonitorSchedulerId(monitorId);

  if (!enabled) {
    await queue.removeJobScheduler(schedulerId).catch((err) => {
      logger.warn({ err, monitorId }, 'Failed to remove monitor job scheduler');
    });
    return;
  }

  await queue.upsertJobScheduler(
    schedulerId,
    { every: intervalSeconds * 1000 },
    {
      name: 'execute-check',
      data: {
        monitorId,
        reason: 'scheduled',
      },
    },
  );
}

export async function enqueueImmediateMonitorCheck(
  monitorId: string,
  reason: 'initial' | 'manual' = 'manual',
): Promise<string | undefined> {
  const queue = getMonitorQueue();
  const bucket = Math.floor(Date.now() / 10_000);
  const job = await queue.add(
    'execute-check',
    { monitorId, reason },
    {
      jobId: `${reason}-${monitorId}-${bucket}`,
    },
  );
  return job.id;
}

export async function closeMonitorQueue(): Promise<void> {
  if (monitorQueue) {
    await monitorQueue.close().catch(() => {});
    monitorQueue = null;
  }
}
