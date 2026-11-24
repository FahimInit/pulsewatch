import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('Authentication, Refresh Token Rotation & Project RBAC / Anti-IDOR', () => {
  const app = createApp();

  it('registers a user, provisions a default project, rotates refresh tokens, and blocks token replay', async () => {
    const agent = request.agent(app);

    const regRes = await agent.post('/api/v1/auth/register').send({
      name: 'Alice Architect',
      email: 'alice@pulsewatch.test',
      password: 'Password123',
    });

    expect(regRes.status).toBe(201);
    expect(regRes.body.user.email).toBe('alice@pulsewatch.test');
    expect(regRes.body.accessToken).toBeTruthy();
    expect(regRes.body.defaultProjectId).toBeTruthy();

    const firstCookies = regRes.headers['set-cookie'];
    expect(firstCookies).toBeDefined();

    // Duplicate email rejected
    const dupRes = await request(app).post('/api/v1/auth/register').send({
      name: 'Alice Clone',
      email: 'alice@pulsewatch.test',
      password: 'Password123',
    });
    expect(dupRes.status).toBe(409);

    // Fetch /auth/me with access token
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${regRes.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.name).toBe('Alice Architect');

    // Rotate refresh token once -> succeeds and issues new cookie
    const refreshRes1 = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', firstCookies);
    expect(refreshRes1.status).toBe(200);
    expect(refreshRes1.body.accessToken).toBeTruthy();
    const secondCookies = refreshRes1.headers['set-cookie'];

    // Replay the OLD first cookie -> Reuse detected! Entire token family must be revoked!
    const replayRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', firstCookies);
    expect(replayRes.status).toBe(401);
    expect(replayRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');

    // Now even the second cookie in that family must be rejected!
    const afterReplayRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', secondCookies);
    expect(afterReplayRes.status).toBe(401);
  });

  it('enforces project CRUD, collaborator RBAC, and prevents cross-tenant IDOR', async () => {
    const ownerRes = await request(app).post('/api/v1/auth/register').send({
      name: 'Owner User',
      email: 'owner@pulsewatch.test',
      password: 'Password123',
    });
    const ownerToken = ownerRes.body.accessToken as string;

    const outsiderRes = await request(app).post('/api/v1/auth/register').send({
      name: 'Outsider User',
      email: 'outsider@pulsewatch.test',
      password: 'Password123',
    });
    const outsiderToken = outsiderRes.body.accessToken as string;

    // Owner creates a second project
    const createProjRes = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Payments Core', description: 'Critical payment APIs' });

    expect(createProjRes.status).toBe(201);
    const projectId = createProjRes.body.project.id as string;

    // Outsider attempts IDOR GET & PATCH -> must receive 404 (not leaking existence)
    const idorGet = await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(idorGet.status).toBe(404);

    const idorPatch = await request(app)
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ name: 'Pwned' });
    expect(idorPatch.status).toBe(404);

    // Owner invites outsider as VIEWER
    const addMemberRes = await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'outsider@pulsewatch.test', role: 'VIEWER' });
    expect(addMemberRes.status).toBe(201);

    // VIEWER can read project, but cannot PATCH (requires ADMIN) or DELETE (requires OWNER)
    const viewerGet = await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(viewerGet.status).toBe(200);
    expect(viewerGet.body.project.role).toBe('VIEWER');

    const viewerPatch = await request(app)
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ name: 'Unauthorized Rename' });
    expect(viewerPatch.status).toBe(403);

    // Owner can delete second project cleanly
    const delRes = await request(app)
      .delete(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(delRes.status).toBe(204);
  });
});
