import { Queue, Worker } from 'bullmq';
import { QUEUE_NAMES, type MonitorCheckJobPayload } from '@pulsewatch/shared';
import {
  createWorkerRedisConnection,
  workerLogger,
  workerPrisma,
} from '../config';

/**
 * Self-healing scheduler reconciliation: ensures every active monitor in PostgreSQL
 * has an up-to-date BullMQ JobScheduler in Redis, and removes orphaned schedulers.
 */
export async function reconcileMonitorSchedulers(
  monitorQueue: Queue<MonitorCheckJobPayload>,
): Promise<{ synced: number; removed: number }> {
  const activeMonitors = await workerPrisma.monitor.findMany({
    where: { status: { not: 'PAUSED' } },
    select: { id: true, intervalSeconds: true },
  });

  const activeMap = new Map(activeMonitors.map((m) => [`monitor:${m.id}`, m]));
  const existingSchedulers = await monitorQueue.getJobSchedulers();

  let removed = 0;
  for (const sched of existingSchedulers) {
    const key = sched.key || sched.id;
    if (key && key.startsWith('monitor:') && !activeMap.has(key)) {
      await monitorQueue.removeJobScheduler(key).catch(() => {});
      removed += 1;
    }
  }

  for (const m of activeMonitors) {
    await monitorQueue.upsertJobScheduler(
      `monitor:${m.id}`,
      { every: m.intervalSeconds * 1000 },
      {
        name: 'execute-check',
        data: { monitorId: m.id, reason: 'scheduled' },
      },
    );
  }

  // Update scheduled MaintenanceWindow lifecycle states automatically
  const now = new Date();
  await workerPrisma.maintenanceWindow.updateMany({
    where: { status: 'SCHEDULED', startsAt: { lte: now }, endsAt: { gt: now } },
    data: { status: 'IN_PROGRESS' },
  });
  await workerPrisma.maintenanceWindow.updateMany({
    where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] }, endsAt: { lte: now } },
    data: { status: 'COMPLETED' },
  });

  return { synced: activeMonitors.length, removed };
}

/**
 * Bounded-batch retention pruning for raw MonitoringResult rows older than retention policy,
 * avoiding long-held table locks while preserving 365-day MonitorDailyRollup records.
 */
export async function pruneExpiredMonitoringResults(retentionDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await workerPrisma.$executeRaw`
    DELETE FROM "monitoring_results"
    WHERE "id" IN (
      SELECT "id"
      FROM "monitoring_results"
      WHERE "checked_at" < ${cutoff}
      LIMIT 10000
    )
  `;
  return Number(deleted);
}

export async function startMaintenanceSubsystem(): Promise<{
  maintenanceQueue: Queue;
  maintenanceWorker: Worker;
  monitorProducerQueue: Queue<MonitorCheckJobPayload>;
}> {
  const monitorProducerQueue = new Queue<MonitorCheckJobPayload>(QUEUE_NAMES.MONITOR_CHECK, {
    connection: createWorkerRedisConnection(),
  });

  const maintenanceQueue = new Queue(QUEUE_NAMES.SYSTEM_MAINTENANCE, {
    connection: createWorkerRedisConnection(),
  });

  // Run initial reconciliation immediately on boot
  const initial = await reconcileMonitorSchedulers(monitorProducerQueue);
  workerLogger.info(initial, 'Initial BullMQ monitor schedule reconciliation complete');

  await maintenanceQueue.upsertJobScheduler(
    'reconcile-every-5m',
    { every: 5 * 60 * 1000 },
    { name: 'reconcile' },
  );

  await maintenanceQueue.upsertJobScheduler(
    'prune-retention-every-6h',
    { every: 6 * 60 * 60 * 1000 },
    { name: 'retention' },
  );

  const maintenanceWorker = new Worker(
    QUEUE_NAMES.SYSTEM_MAINTENANCE,
    async (job) => {
      if (job.name === 'reconcile') {
        return reconcileMonitorSchedulers(monitorProducerQueue);
      }
      if (job.name === 'retention') {
        const retentionDays = Number(process.env.RAW_RESULT_RETENTION_DAYS || 30);
        return pruneExpiredMonitoringResults(retentionDays);
      }
      return null;
    },
    {
      connection: createWorkerRedisConnection(),
      concurrency: 1,
    },
  );

  return { maintenanceQueue, maintenanceWorker, monitorProducerQueue };
}
