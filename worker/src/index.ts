import dotenv from 'dotenv';
import path from 'node:path';
import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const workerLogger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

export const workerPrisma = new PrismaClient({
  log: ['error'],
});

export function createWorkerRedisConnection(): Redis {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const conn = new Redis(url, {
    maxRetriesPerRequest: null,
  });
  conn.on('error', (err) => {
    workerLogger.error({ err }, 'Worker Redis connection error');
  });
  return conn;
}

async function bootstrap(): Promise<void> {
  const redis = createWorkerRedisConnection();
  await workerPrisma.$queryRaw`SELECT 1`;
  await redis.ping();
  workerLogger.info('Pulsewatch worker connected to PostgreSQL and Redis');

  const shutdown = async (signal: string) => {
    workerLogger.info({ signal }, 'Gracefully stopping Pulsewatch worker...');
    await redis.quit().catch(() => redis.disconnect());
    await workerPrisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (require.main === module) {
  bootstrap().catch((err) => {
    workerLogger.fatal({ err }, 'Pulsewatch worker failed to start');
    process.exit(1);
  });
}
