import type http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import {
  REDIS_PUBSUB_CHANNEL,
  type RealtimeEventPayload,
} from '@pulsewatch/shared';
import { getEnv } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { createRedisConnection } from '../config/redis';
import type { AccessTokenJwtPayload } from '../middleware/auth';

export interface RealtimeGateway {
  io: SocketIOServer;
  close: () => Promise<void>;
}

export function attachSocketGateway(httpServer: http.Server): RealtimeGateway {
  const env = getEnv();
  const allowedOrigins = env.CLIENT_ORIGIN.split(',').map((o) => o.trim());

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.NODE_ENV === 'test' ? '*' : allowedOrigins,
      credentials: true,
    },
  });

  // Authenticate WebSocket handshakes via JWT
  io.use((socket, next) => {
    const rawToken =
      (socket.handshake.auth?.token as string | undefined) ||
      (socket.handshake.headers.authorization?.startsWith('Bearer ')
        ? socket.handshake.headers.authorization.slice(7)
        : undefined);

    if (!rawToken) {
      next(new Error('UNAUTHORIZED'));
      return;
    }

    try {
      const payload = jwt.verify(rawToken, env.JWT_ACCESS_SECRET) as AccessTokenJwtPayload;
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);

    socket.on('join:project', async (projectId: string, ack?: (ok: boolean) => void) => {
      try {
        if (!projectId || typeof projectId !== 'string') {
          ack?.(false);
          return;
        }
        const member = await prisma.projectMember.findUnique({
          where: {
            projectId_userId: { projectId, userId },
          },
          select: { id: true },
        });

        if (!member) {
          ack?.(false);
          return;
        }

        // Leave previously joined project rooms to keep subscriptions clean
        for (const room of socket.rooms) {
          if (room.startsWith('project:') && room !== `project:${projectId}`) {
            socket.leave(room);
          }
        }
        socket.join(`project:${projectId}`);
        ack?.(true);
      } catch {
        ack?.(false);
      }
    });
  });

  // Subscribe to worker domain events published over Redis Pub/Sub
  const subscriber = createRedisConnection();
  subscriber.subscribe(REDIS_PUBSUB_CHANNEL).catch((err) => {
    logger.error({ err }, 'Failed to subscribe to Redis realtime channel');
  });

  subscriber.on('message', (channel, rawMessage) => {
    if (channel !== REDIS_PUBSUB_CHANNEL) return;
    try {
      const event = JSON.parse(rawMessage) as RealtimeEventPayload;
      if (event.type === 'notification:new') {
        io.to(`user:${event.userId}`).emit(event.type, event);
      } else {
        io.to(`project:${event.projectId}`).emit(event.type, event);
      }
    } catch (err) {
      logger.warn({ err }, 'Malformed realtime Redis message');
    }
  });

  return {
    io,
    close: async () => {
      await subscriber.quit().catch(() => subscriber.disconnect());
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
