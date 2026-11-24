import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';

describe('Alert Rules & In-App Notification Center', () => {
  const app = createApp();

  it('manages alert rules, validates email channel recipients, and marks in-app notifications read', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      name: 'Alert Engineer',
      email: 'alerts@pulsewatch.test',
      password: 'Password123',
    });
    const token = reg.body.accessToken as string;
    const projectId = reg.body.defaultProjectId as string;
    const userId = reg.body.user.id as string;

    // Default alert rules created on project setup
    const listRes = await request(app)
      .get(`/api/v1/projects/${projectId}/alert-rules`)
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.alertRules.length).toBeGreaterThanOrEqual(2);

    // Reject EMAIL channel when recipientEmails is empty
    const invalidEmailRule = await request(app)
      .post(`/api/v1/projects/${projectId}/alert-rules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Broken Email Rule',
        triggerType: 'HIGH_LATENCY',
        thresholdValue: 500,
        channels: ['EMAIL'],
        recipientEmails: [],
      });
    expect(invalidEmailRule.status).toBe(400);

    // Create valid HIGH_LATENCY rule
    const createRes = await request(app)
      .post(`/api/v1/projects/${projectId}/alert-rules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Latency > 600ms',
        triggerType: 'HIGH_LATENCY',
        thresholdValue: 600,
        cooldownMinutes: 10,
        channels: ['IN_APP', 'EMAIL'],
        recipientEmails: ['sre@pulsewatch.test'],
      });
    expect(createRes.status).toBe(201);
    const ruleId = createRes.body.alertRule.id as string;

    // Toggle rule disabled
    const disableRes = await request(app)
      .patch(`/api/v1/projects/${projectId}/alert-rules/${ruleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.alertRule.enabled).toBe(false);

    // Seed an unread in-app notification and test unread count + read-all
    const notif = await prisma.notification.create({
      data: {
        projectId,
        userId,
        channel: 'IN_APP',
        type: 'MONITOR_DOWN',
        title: '[DOWN] Payments API',
        body: 'Endpoint timed out after 5000ms',
        deliveryStatus: 'SENT',
      },
    });

    const getNotifs = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${token}`);
    expect(getNotifs.status).toBe(200);
    expect(getNotifs.body.unreadCount).toBe(1);

    const markOne = await request(app)
      .patch(`/api/v1/notifications/${notif.id}/read`)
      .set('Authorization', `Bearer ${token}`);
    expect(markOne.status).toBe(200);
    expect(markOne.body.notification.readAt).toBeTruthy();

    const afterRead = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${token}`);
    expect(afterRead.body.unreadCount).toBe(0);
  });
});
