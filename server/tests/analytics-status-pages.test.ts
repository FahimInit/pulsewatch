import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';

describe('Historical SQL Analytics, Public Status Pages & Maintenance Windows', () => {
  const app = createApp();

  it('computes real SQL overview/percentile analytics and serves sanitized public status pages', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      name: 'Analytics Lead',
      email: 'analytics@pulsewatch.test',
      password: 'Password123',
    });
    const token = reg.body.accessToken as string;
    const projectId = reg.body.defaultProjectId as string;

    const publicMon = await prisma.monitor.create({
      data: {
        projectId,
        name: 'Public Gateway API',
        url: 'https://gateway.example.com/health',
        headers: { Authorization: 'Bearer super-secret-internal-token' },
        status: 'OPERATIONAL',
        lastResponseTimeMs: 120,
      },
    });

    const internalMon = await prisma.monitor.create({
      data: {
        projectId,
        name: 'Secret Internal Billing Worker',
        url: 'https://billing.example.com/health',
        status: 'DEGRADED',
      },
    });

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    await prisma.monitoringResult.createMany({
      data: [
        {
          monitorId: publicMon.id,
          checkedAt: new Date(now.getTime() - 20 * 60 * 1000),
          status: 'OPERATIONAL',
          statusCode: 200,
          responseTimeMs: 110,
        },
        {
          monitorId: publicMon.id,
          checkedAt: new Date(now.getTime() - 10 * 60 * 1000),
          status: 'OPERATIONAL',
          statusCode: 200,
          responseTimeMs: 150,
        },
        {
          monitorId: internalMon.id,
          checkedAt: new Date(now.getTime() - 5 * 60 * 1000),
          status: 'DOWN',
          statusCode: 502,
          responseTimeMs: 900,
        },
      ],
    });

    await prisma.monitorDailyRollup.create({
      data: {
        monitorId: publicMon.id,
        day: todayUtc,
        totalChecks: 100,
        upChecks: 99,
        degradedChecks: 0,
        downChecks: 1,
        avgLatencyMs: 128.5,
      },
    });

    // 1. Verify Overview SQL analytics
    const overviewRes = await request(app)
      .get(`/api/v1/projects/${projectId}/analytics/overview?range=24h`)
      .set('Authorization', `Bearer ${token}`);
    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.overview.overallUptime).toBeCloseTo(66.67, 1);
    expect(overviewRes.body.overview.avgResponseTimeMs).toBe(387);
    expect(overviewRes.body.overview.activeMonitors).toBe(2);

    // 2. Verify Response-Time P95 & Avg SQL series
    const rtRes = await request(app)
      .get(`/api/v1/projects/${projectId}/analytics/response-times?range=24h`)
      .set('Authorization', `Bearer ${token}`);
    expect(rtRes.status).toBe(200);
    expect(rtRes.body.series.length).toBeGreaterThanOrEqual(1);
    expect(rtRes.body.series[0].p95Ms).toBeGreaterThanOrEqual(rtRes.body.series[0].avgMs);

    // 3. Verify Health Distribution
    const distRes = await request(app)
      .get(`/api/v1/projects/${projectId}/analytics/health-distribution`)
      .set('Authorization', `Bearer ${token}`);
    expect(distRes.status).toBe(200);
    const opEntry = distRes.body.distribution.find(
      (d: { status: string; count: number }) => d.status === 'OPERATIONAL',
    );
    expect(opEntry.count).toBe(1);

    // 4. Create Public Status Page exposing ONLY publicMon
    const createSpRes = await request(app)
      .post(`/api/v1/projects/${projectId}/status-pages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Acme Cloud Status',
        slug: 'acme-cloud',
        description: 'Live API availability',
        isPublic: true,
        showUptimeHistory: true,
        showIncidents: true,
        monitors: [
          {
            monitorId: publicMon.id,
            displayName: 'Core Gateway',
            groupName: 'APIs',
            sortOrder: 0,
          },
        ],
      });
    expect(createSpRes.status).toBe(201);
    const pageId = createSpRes.body.statusPage.id as string;

    // 5. Schedule Maintenance Window
    const maintRes = await request(app)
      .post(`/api/v1/projects/${projectId}/maintenance-windows`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Planned TLS Certificate Rotation',
        description: 'Zero-downtime edge certificate renewal',
        statusPageId: pageId,
        startsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        endsAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        suppressAlerts: true,
        monitorIds: [publicMon.id],
      });
    expect(maintRes.status).toBe(201);

    // 6. Query unauthenticated public status endpoint
    const pubRes = await request(app).get('/api/v1/public/status-pages/acme-cloud');
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.statusPage.overallStatus).toBe('ALL_OPERATIONAL');
    expect(pubRes.body.services.length).toBe(1);
    expect(pubRes.body.services[0].displayName).toBe('Core Gateway');
    expect(pubRes.body.services[0].uptime90d).toBe(99);
    expect(pubRes.body.services[0].dailyBars.length).toBe(90);
    expect(pubRes.body.maintenanceWindows.length).toBe(1);

    // Ensure sensitive monitor headers / unlisted monitors are NEVER leaked publicly
    const serialized = JSON.stringify(pubRes.body);
    expect(serialized).not.toContain('super-secret-internal-token');
    expect(serialized).not.toContain('Secret Internal Billing Worker');

    // 7. Toggle status page private -> public endpoint must return 404
    await request(app)
      .patch(`/api/v1/projects/${projectId}/status-pages/${pageId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isPublic: false });

    const privateRes = await request(app).get('/api/v1/public/status-pages/acme-cloud');
    expect(privateRes.status).toBe(404);
  });
});
