import {
  REDIS_PUBSUB_CHANNEL,
  type RealtimeEventPayload,
} from '@pulsewatch/shared';
import { getRedisClient } from '../config/redis';
import { logger } from '../config/logger';

export async function publishServerRealtimeEvent(event: RealtimeEventPayload): Promise<void> {
  try {
    await getRedisClient().publish(REDIS_PUBSUB_CHANNEL, JSON.stringify(event));
  } catch (err) {
    logger.warn({ err, type: event.type }, 'Failed to publish server realtime event');
  }
}
