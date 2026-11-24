import http from 'node:http';
import { createApp } from './app';
import { getEnv } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';
import { closeSharedRedis } from './config/redis';
import { closeMonitorQueue } from './queues/monitor.queue';
import { attachSocketGateway } from './realtime/socket';

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const app = createApp();
  const httpServer = http.createServer(app);
  const realtime = attachSocketGateway(httpServer);

  let embeddedWorker: { shutdown: () => Promise<void> } | null = null;
  if (env.ENABLE_EMBEDDED_WORKER) {
    try {
      // Loaded dynamically so server stays decoupled in multi-container deployments
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const workerMod = require('../../worker/dist/index.js') as {
        startWorkerEngine: () => Promise<{ shutdown: () => Promise<void> }>;
      };
      embeddedWorker = await workerMod.startWorkerEngine();
      logger.info('Embedded BullMQ monitoring worker started inside API process');
    } catch (err) {
      logger.error({ err }, 'Failed to start embedded worker (continuing as API-only)');
    }
  }

  httpServer.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Pulsewatch API & Socket.IO server listening');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down Pulsewatch API server...');
    await realtime.close();
    if (embeddedWorker) {
      await embeddedWorker.shutdown();
    }
    httpServer.close(async () => {
      await closeMonitorQueue();
      await closeSharedRedis();
      await prisma.$disconnect();
      logger.info('API server stopped cleanly');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (require.main === module) {
  bootstrap().catch((err) => {
    logger.fatal({ err }, 'Failed to start Pulsewatch API server');
    process.exit(1);
  });
}
