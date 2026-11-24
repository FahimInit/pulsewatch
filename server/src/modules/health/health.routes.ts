import { Router } from 'express';
import { prisma } from '../../config/prisma';
import { getRedisClient } from '../../config/redis';
import { asyncHandler } from '../../middleware/validate';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'pulsewatch-server',
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get(
  '/health/ready',
  asyncHandler(async (_req, res) => {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const pong = await getRedisClient().ping();

    res.status(200).json({
      status: 'ready',
      checks: {
        database: 'ok',
        redis: pong === 'PONG' ? 'ok' : 'degraded',
      },
      latencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  }),
);
