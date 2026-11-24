import { workerLogger, workerPrisma } from './config';
import {
  startMonitorCheckWorker,
  startNotificationDispatchWorker,
} from './processors/workers';
import { startMaintenanceSubsystem } from './processors/maintenance.processor';
import { closeEvaluatorConnections } from './engine/check-evaluator';
import { closeWorkerPublisher } from './events/publisher';

export * from './checker/http-checker';
export * from './engine/check-evaluator';
export * from './processors/workers';
export * from './processors/maintenance.processor';
export * from './notifications/mailer';

async function bootstrap(): Promise<void> {
  await workerPrisma.$queryRaw`SELECT 1`;

  const checkWorker = startMonitorCheckWorker();
  const notificationWorker = startNotificationDispatchWorker();
  const { maintenanceQueue, maintenanceWorker, monitorProducerQueue } =
    await startMaintenanceSubsystem();

  workerLogger.info('Pulsewatch background monitoring engine online');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    workerLogger.info({ signal }, 'Draining in-flight BullMQ jobs before shutdown...');

    const forceTimer = setTimeout(() => {
      workerLogger.error('Graceful drain timed out after 35s; forcing exit');
      process.exit(1);
    }, 35_000);
    forceTimer.unref();

    await Promise.allSettled([
      checkWorker.close(),
      notificationWorker.close(),
      maintenanceWorker.close(),
    ]);
    await Promise.allSettled([
      maintenanceQueue.close(),
      monitorProducerQueue.close(),
      closeEvaluatorConnections(),
      closeWorkerPublisher(),
      workerPrisma.$disconnect(),
    ]);

    workerLogger.info('Pulsewatch worker exited cleanly');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (require.main === module) {
  bootstrap().catch((err) => {
    workerLogger.fatal({ err }, 'Fatal error starting Pulsewatch worker');
    process.exit(1);
  });
}
