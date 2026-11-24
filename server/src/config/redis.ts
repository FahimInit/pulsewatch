import Redis from 'ioredis';
import { getEnv } from './env';
import { logger } from './logger';

let sharedClient: Redis | null = null;
let sharedUrl: string | null = null;

export function getRedisClient(): Redis {
  const { REDIS_URL } = getEnv();
  if (!sharedClient || sharedUrl !== REDIS_URL) {
    if (sharedClient) {
      sharedClient.disconnect();
    }
    sharedUrl = REDIS_URL;
    sharedClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    sharedClient.on('error', (err) => {
      logger.error({ err }, 'Redis client error');
    });
  }
  return sharedClient;
}

export function createRedisConnection(options: { forBullMq?: boolean } = {}): Redis {
  const { REDIS_URL } = getEnv();
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: options.forBullMq ? null : 3,
    enableReadyCheck: !options.forBullMq,
  });
  client.on('error', (err) => {
    logger.error({ err }, 'Dedicated Redis connection error');
  });
  return client;
}

export async function closeSharedRedis(): Promise<void> {
  if (sharedClient) {
    await sharedClient.quit().catch(() => {
      sharedClient?.disconnect();
    });
    sharedClient = null;
    sharedUrl = null;
  }
}
