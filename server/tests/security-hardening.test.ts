import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('Security Hardening: Headers, SQL Injection Immunity, Rate Limiting & Error Redaction', () => {
  const app = createApp();

  it('sets Helmet security headers, hides X-Powered-By, and safely parameterizes SQLi inputs', async () => {
    const healthRes = await request(app).get('/api/v1/health');
    expect(healthRes.headers['x-powered-by']).toBeUndefined();
    expect(healthRes.headers['x-content-type-options']).toBe('nosniff');

    const reg = await request(app).post('/api/v1/auth/register').send({
      name: 'Sec Auditor',
      email: 'sec-auditor@pulsewatch.test',
      password: 'Password123',
    });
    const token = reg.body.accessToken as string;
    const projectId = reg.body.defaultProjectId as string;

    // SQL injection payloads in search query and public slug must be harmlessly parameterized
    const sqliSearch = await request(app)
      .get(`/api/v1/projects/${projectId}/monitors`)
      .query({ search: "' OR 1=1; DROP TABLE users; --" })
      .set('Authorization', `Bearer ${token}`);
    expect(sqliSearch.status).toBe(200);
    expect(Array.isArray(sqliSearch.body.monitors)).toBe(true);

    const sqliSlug = await request(app).get(
      "/api/v1/public/status-pages/'%20OR%20'1'='1",
    );
    expect(sqliSlug.status).toBe(404);
    expect(sqliSlug.body.stack).toBeUndefined();
  });

  it('enforces brute-force rate limiting on authentication endpoints when enabled', async () => {
    process.env.ENFORCE_RATE_LIMIT = 'true';
    try {
      const rateLimitedApp = createApp();
      let lastStatus = 0;

      for (let i = 0; i < 22; i++) {
        const res = await request(rateLimitedApp).post('/api/v1/auth/login').send({
          email: 'nobody@pulsewatch.test',
          password: 'WrongPassword123',
        });
        lastStatus = res.status;
        if (lastStatus === 429) break;
      }

      expect(lastStatus).toBe(429);
    } finally {
      delete process.env.ENFORCE_RATE_LIMIT;
    }
  });
});
