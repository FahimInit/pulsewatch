import http from 'node:http';
import { createApp } from './app';
import { getEnv } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';
import { closeSharedRedis } from './config/redis';

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const app = createApp();
  const httpServer = http.createServer(app);

  httpServer.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Pulsewatch API server listening');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down Pulsewatch API server...');
    httpServer.close(async () => {
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
