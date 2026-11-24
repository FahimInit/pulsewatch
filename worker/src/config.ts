import dotenv from 'dotenv';
import path from 'node:path';
import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// BigInt JSON serialization support
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

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

declare global {
  // eslint-disable-next-line no-var
  var __pulsewatchWorkerPrisma: PrismaClient | undefined;
}

export const workerPrisma: PrismaClient =
  global.__pulsewatchWorkerPrisma ??
  new PrismaClient({
    log: ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__pulsewatchWorkerPrisma = workerPrisma;
}

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
