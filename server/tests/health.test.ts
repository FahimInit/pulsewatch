import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { closeSharedRedis } from '../src/config/redis';

describe('System Health & Readiness Probes', () => {
  const app = createApp();

  afterAll(async () => {
    await closeSharedRedis();
    await prisma.$disconnect();
  });

  it('GET /api/v1/health returns liveness status 200', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('pulsewatch-server');
  });

  it('GET /api/v1/health/ready verifies live PostgreSQL and Redis connectivity', async () => {
    const res = await request(app).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database).toBe('ok');
    expect(res.body.checks.redis).toBe('ok');
  });

  it('returns structured 404 JSON for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
