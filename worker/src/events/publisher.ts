import Redis from 'ioredis';
import {
  REDIS_PUBSUB_CHANNEL,
  type RealtimeEventPayload,
} from '@pulsewatch/shared';
import { workerLogger } from '../config';

let pubClient: Redis | null = null;
let pubUrl: string | null = null;

function getPublisher(): Redis {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  if (!pubClient || pubUrl !== url) {
    if (pubClient) pubClient.disconnect();
    pubUrl = url;
    pubClient = new Redis(url, { maxRetriesPerRequest: 3 });
    pubClient.on('error', (err) => {
      workerLogger.warn({ err }, 'Worker Redis publisher error');
    });
  }
  return pubClient;
}

export async function publishRealtimeEvent(event: RealtimeEventPayload): Promise<void> {
  try {
    await getPublisher().publish(REDIS_PUBSUB_CHANNEL, JSON.stringify(event));
  } catch (err) {
    workerLogger.warn({ err, type: event.type }, 'Failed to publish realtime event');
  }
}

export async function closeWorkerPublisher(): Promise<void> {
  if (pubClient) {
    await pubClient.quit().catch(() => pubClient?.disconnect());
    pubClient = null;
    pubUrl = null;
  }
}
