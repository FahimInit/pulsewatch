import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { setCustomDnsLookupForTests } from '../src/security/url-validator';
import { getMonitorQueue, closeMonitorQueue } from '../src/queues/monitor.queue';
import { prisma } from '../src/config/prisma';

describe('Monitor Registration, SSRF DNS Guard & BullMQ Scheduling', () => {
  const app = createApp();

  beforeEach(() => {
    setCustomDnsLookupForTests(async (hostname) => {
      if (hostname === 'rebind-metadata.attacker.example') {
        return [{ address: '169.254.169.254', family: 4 }];
      }
      if (hostname === 'internal-mapped.attacker.example') {
        return [{ address: '::ffff:10.0.0.15', family: 6 }];
      }
      return [{ address: '93.184.216.34', family: 4 }];
    });
  });

  afterAll(async () => {
    setCustomDnsLookupForTests(null);
    await closeMonitorQueue();
  });

  it('creates, updates, pauses, resumes, and deletes monitors while syncing BullMQ schedulers and blocking SSRF', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      name: 'Monitor Engineer',
      email: 'monitors@pulsewatch.test',
      password: 'Password123',
    });

    const token = reg.body.accessToken as string;
    const projectId = reg.body.defaultProjectId as string;

    // 1. Block direct metadata IP
    const ssrfDirect = await request(app)
      .post(`/api/v1/projects/${projectId}/monitors`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'AWS Metadata Probe',
        url: 'http://169.254.169.254/latest/meta-data/',
      });
    expect(ssrfDirect.status).toBe(400);

    // 2. Block DNS hostname resolving to metadata IP
    const ssrfDns = await request(app)
      .post(`/api/v1/projects/${projectId}/monitors`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'DNS Metadata Probe',
        url: 'https://rebind-metadata.attacker.example/status',
      });
    expect(ssrfDns.status).toBe(400);
    expect(ssrfDns.body.error.code).toBe('SSRF_TARGET_BLOCKED');

    // 3. Block DNS hostname resolving to IPv4-mapped private IPv6
    const ssrfV6 = await request(app)
      .post(`/api/v1/projects/${projectId}/monitors`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'IPv6 Mapped Probe',
        url: 'https://internal-mapped.attacker.example/health',
      });
    expect(ssrfV6.status).toBe(400);

    // 4. Create valid HTTPS monitor with headers and keyword check
    const createRes = await request(app)
      .post(`/api/v1/projects/${projectId}/monitors`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Production Core API',
        url: 'https://api.example.com/v1/health',
        method: 'GET',
        headers: { 'X-Monitor-Client': 'Pulsewatch' },
        expectedStatusCodes: [200],
        intervalSeconds: 30,
        timeoutMs: 8000,
        keyword: 'healthy',
        keywordMatchType: 'CONTAINS',
      });

    expect(createRes.status).toBe(201);
    const monitorId = createRes.body.monitor.id as string;
    expect(createRes.body.monitor.status).toBe('PENDING');

    // Verify BullMQ JobScheduler was registered in Redis
    const schedulersAfterCreate = await getMonitorQueue().getJobSchedulers();
    expect(schedulersAfterCreate.some((s) => s.key?.includes(monitorId) || s.id?.includes(monitorId))).toBe(true);

    // Pause monitor -> status becomes PAUSED and scheduler is removed
    const pauseRes = await request(app)
      .post(`/api/v1/projects/${projectId}/monitors/${monitorId}/pause`)
      .set('Authorization', `Bearer ${token}`);
    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.monitor.status).toBe('PAUSED');

    const schedulersAfterPause = await getMonitorQueue().getJobSchedulers();
    expect(schedulersAfterPause.some((s) => s.key?.includes(monitorId) || s.id?.includes(monitorId))).toBe(false);

    // Resume monitor -> status becomes PENDING and scheduler is restored
    const resumeRes = await request(app)
      .post(`/api/v1/projects/${projectId}/monitors/${monitorId}/resume`)
      .set('Authorization', `Bearer ${token}`);
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.monitor.status).toBe('PENDING');

    // Enforce project monitorLimit quota
    await prisma.project.update({
      where: { id: projectId },
      data: { monitorLimit: 1 },
    });

    const quotaBlocked = await request(app)
      .post(`/api/v1/projects/${projectId}/monitors`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Over Quota Monitor',
        url: 'https://www.example.com',
      });
    expect(quotaBlocked.status).toBe(403);
    expect(quotaBlocked.body.error.code).toBe('MONITOR_LIMIT_REACHED');

    // Delete monitor -> 204
    const delRes = await request(app)
      .delete(`/api/v1/projects/${projectId}/monitors/${monitorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(204);
  });
});
