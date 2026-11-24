import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';

describe('Incident Triage Workflow: Acknowledge, Status Transitions, Notes & Resolution', () => {
  const app = createApp();

  it('supports acknowledging, adding investigation notes, changing status, resolving, and blocks IDOR', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      name: 'Incident Commander',
      email: 'ic@pulsewatch.test',
      password: 'Password123',
    });
    const token = reg.body.accessToken as string;
    const projectId = reg.body.defaultProjectId as string;

    const outsider = await request(app).post('/api/v1/auth/register').send({
      name: 'External User',
      email: 'external-ic@pulsewatch.test',
      password: 'Password123',
    });

    const monitor = await prisma.monitor.create({
      data: {
        projectId,
        name: 'Checkout API',
        url: 'https://checkout.example.com/health',
        status: 'DOWN',
      },
    });

    const incident = await prisma.incident.create({
      data: {
        projectId,
        monitorId: monitor.id,
        title: 'Checkout API 503 Outage',
        summary: 'Upstream gateway returned HTTP 503',
        severity: 'CRITICAL',
        status: 'INVESTIGATING',
        events: {
          create: {
            type: 'DETECTED',
            message: 'Incident automatically detected.',
          },
        },
      },
    });

    // Cross-tenant IDOR attempt must return 404
    const idorRes = await request(app)
      .get(`/api/v1/projects/${projectId}/incidents/${incident.id}`)
      .set('Authorization', `Bearer ${outsider.body.accessToken}`);
    expect(idorRes.status).toBe(404);

    // 1. Acknowledge incident -> transitions INVESTIGATING -> IDENTIFIED
    const ackRes = await request(app)
      .post(`/api/v1/projects/${projectId}/incidents/${incident.id}/acknowledge`)
      .set('Authorization', `Bearer ${token}`);
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.incident.status).toBe('IDENTIFIED');
    expect(ackRes.body.incident.acknowledgedAt).toBeTruthy();

    // 2. Append investigation note
    const noteRes = await request(app)
      .post(`/api/v1/projects/${projectId}/incidents/${incident.id}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Identified Redis connection saturation on primary node.' });
    expect(noteRes.status).toBe(201);
    expect(noteRes.body.event.type).toBe('INVESTIGATION_NOTE');

    // 3. Transition status to MONITORING
    const statusRes = await request(app)
      .patch(`/api/v1/projects/${projectId}/incidents/${incident.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'MONITORING' });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.incident.status).toBe('MONITORING');

    // 4. Resolve incident with resolution notes
    const resolveRes = await request(app)
      .post(`/api/v1/projects/${projectId}/incidents/${incident.id}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ resolutionNotes: 'Increased maxclients and verified zero 503s for 15 minutes.' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.incident.status).toBe('RESOLVED');
    expect(resolveRes.body.incident.events.length).toBe(5);
  });
});
