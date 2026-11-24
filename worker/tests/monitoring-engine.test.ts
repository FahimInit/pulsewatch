import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  executeHttpHealthCheck,
  runMonitorCheckAndEvaluate,
  startNotificationDispatchWorker,
  setCustomMailSenderForTests,
  closeEvaluatorConnections,
  type EmailMessage,
} from '../src';
import { workerPrisma } from '../src/config';
import { closeWorkerPublisher } from '../src/events/publisher';

describe('Monitoring Engine: HTTP Checker, SSRF Redirect Revalidation, Incident Lifecycle & Alerts', () => {
  let targetServer: http.Server;
  let targetBaseUrl = '';
  let simulatedMode: 'ok' | 'slow' | 'error503' | 'hang' | 'huge' | 'redirect-ssrf' = 'ok';

  beforeAll(async () => {
    targetServer = http.createServer((req, res) => {
      if (simulatedMode === 'ok') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', service: 'orders' }));
        return;
      }
      if (simulatedMode === 'slow') {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'healthy' }));
        }, 180);
        return;
      }
      if (simulatedMode === 'error503') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'upstream_unavailable' }));
        return;
      }
      if (simulatedMode === 'hang') {
        // Do not respond within timeout
        req.on('close', () => {});
        return;
      }
      if (simulatedMode === 'huge') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.write(Buffer.alloc(32 * 1024, 'A'));
        res.end();
        return;
      }
      if (simulatedMode === 'redirect-ssrf') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        const addr = targetServer.address();
        if (addr && typeof addr === 'object') {
          targetBaseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    setCustomMailSenderForTests(null);
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));
    await closeEvaluatorConnections();
    await closeWorkerPublisher();
    await workerPrisma.$disconnect();
  });

  it('measures response time, validates keywords, detects degraded latency, timeouts, and size limits', async () => {
    simulatedMode = 'ok';
    const okOutcome = await executeHttpHealthCheck({
      url: `${targetBaseUrl}/health`,
      method: 'GET',
      expectedStatusCodes: [200],
      timeoutMs: 2000,
      degradedThresholdMs: 500,
      keyword: 'healthy',
      keywordMatchType: 'CONTAINS',
      allowPrivateTargets: true,
    });
    expect(okOutcome.status).toBe('OPERATIONAL');
    expect(okOutcome.statusCode).toBe(200);
    expect(okOutcome.keywordMatched).toBe(true);
    expect(okOutcome.responseTimeMs).toBeGreaterThanOrEqual(1);

    // Keyword mismatch -> DOWN
    const kwFail = await executeHttpHealthCheck({
      url: `${targetBaseUrl}/health`,
      method: 'GET',
      expectedStatusCodes: [200],
      timeoutMs: 2000,
      degradedThresholdMs: 500,
      keyword: 'missing-token',
      keywordMatchType: 'CONTAINS',
      allowPrivateTargets: true,
    });
    expect(kwFail.status).toBe('DOWN');
    expect(kwFail.errorType).toBe('KEYWORD_MISMATCH');

    // Slow response > degradedThresholdMs -> DEGRADED
    simulatedMode = 'slow';
    const degradedOutcome = await executeHttpHealthCheck({
      url: `${targetBaseUrl}/health`,
      method: 'GET',
      expectedStatusCodes: [200],
      timeoutMs: 2000,
      degradedThresholdMs: 100,
      allowPrivateTargets: true,
    });
    expect(degradedOutcome.status).toBe('DEGRADED');
    expect(degradedOutcome.responseTimeMs).toBeGreaterThanOrEqual(150);

    // Response payload exceeding maxResponseBytes -> RESPONSE_TOO_LARGE
    simulatedMode = 'huge';
    const oversized = await executeHttpHealthCheck({
      url: `${targetBaseUrl}/large`,
      method: 'GET',
      expectedStatusCodes: [200],
      timeoutMs: 2000,
      degradedThresholdMs: 500,
      maxResponseBytes: 4096,
      allowPrivateTargets: true,
    });
    expect(oversized.status).toBe('DOWN');
    expect(oversized.errorType).toBe('RESPONSE_TOO_LARGE');

    // Timeout enforcement -> TIMEOUT
    simulatedMode = 'hang';
    const timedOut = await executeHttpHealthCheck({
      url: `${targetBaseUrl}/hang`,
      method: 'GET',
      expectedStatusCodes: [200],
      timeoutMs: 250,
      degradedThresholdMs: 150,
      allowPrivateTargets: true,
    });
    expect(timedOut.status).toBe('DOWN');
    expect(timedOut.errorType).toBe('TIMEOUT');
  });

  it('revalidates redirects and blocks SSRF redirect hops to cloud metadata IPs', async () => {
    simulatedMode = 'redirect-ssrf';
    const port = new URL(targetBaseUrl).port;

    // Simulate a public hostname resolving to our local test HTTP server on hop 0,
    // which responds with 302 -> http://169.254.169.254/latest/meta-data/ on hop 1!
    const redirectSsrf = await executeHttpHealthCheck({
      url: `http://public-service.example:${port}/start`,
      method: 'GET',
      expectedStatusCodes: [200],
      timeoutMs: 2000,
      degradedThresholdMs: 500,
      followRedirects: true,
      allowPrivateTargets: false,
      customLookup: async (host) => {
        if (host === 'public-service.example') {
          return [{ address: '127.0.0.1', family: 4 }];
        }
        return [{ address: '93.184.216.34', family: 4 }];
      },
    });

    // Even hop 0 is blocked because customLookup returned 127.0.0.1 while allowPrivateTargets=false!
    expect(redirectSsrf.status).toBe('DOWN');
    expect(redirectSsrf.errorType).toBe('SSRF_BLOCKED');
  });

  it('opens an incident at failureThreshold, prevents duplicates during ongoing outage, dispatches alerts, and auto-recovers', async () => {
    const sentEmails: EmailMessage[] = [];
    setCustomMailSenderForTests(async (msg) => {
      sentEmails.push(msg);
    });

    const notifWorker = startNotificationDispatchWorker();

    try {
      const user = await workerPrisma.user.create({
        data: {
          name: 'Engine Tester',
          email: 'engine-tester@pulsewatch.test',
          passwordHash: 'not-used-in-worker-test',
        },
      });

      const project = await workerPrisma.project.create({
        data: {
          name: 'Worker Test Workspace',
          slug: `worker-test-${Date.now()}`,
          members: {
            create: { userId: user.id, role: 'OWNER' },
          },
          alertRules: {
            create: [
              {
                name: 'Outage Rule',
                triggerType: 'INCIDENT_CREATED',
                channels: ['IN_APP', 'EMAIL'],
                recipientEmails: ['oncall@pulsewatch.test'],
                cooldownMinutes: 10,
              },
              {
                name: 'Recovery Rule',
                triggerType: 'INCIDENT_RESOLVED',
                channels: ['IN_APP', 'EMAIL'],
                recipientEmails: ['oncall@pulsewatch.test'],
                cooldownMinutes: 1,
              },
            ],
          },
        },
      });

      const monitor = await workerPrisma.monitor.create({
        data: {
          projectId: project.id,
          name: 'Orders API',
          url: `${targetBaseUrl}/orders`,
          method: 'GET',
          expectedStatusCodes: [200],
          timeoutMs: 2000,
          intervalSeconds: 30,
          degradedThresholdMs: 800,
          failureThreshold: 2,
          recoveryThreshold: 2,
        },
      });

      // 1. First healthy check -> OPERATIONAL
      simulatedMode = 'ok';
      const eval1 = await runMonitorCheckAndEvaluate(monitor.id, { allowPrivateTargets: true });
      expect(eval1.currentStatus).toBe('OPERATIONAL');
      expect(eval1.incidentCreatedId).toBeNull();

      // 2. First 503 failure -> consecutiveFailures=1 (< failureThreshold=2), NO incident yet!
      simulatedMode = 'error503';
      const eval2 = await runMonitorCheckAndEvaluate(monitor.id, { allowPrivateTargets: true });
      expect(eval2.incidentCreatedId).toBeNull();

      // 3. Second 503 failure -> consecutiveFailures=2 == failureThreshold -> Incident CREATED!
      const eval3 = await runMonitorCheckAndEvaluate(monitor.id, { allowPrivateTargets: true });
      expect(eval3.currentStatus).toBe('DOWN');
      expect(eval3.incidentCreatedId).toBeTruthy();
      const firstIncidentId = eval3.incidentCreatedId!;

      // 4. Third & Fourth 503 failures during ongoing outage -> ZERO duplicate incidents!
      const eval4 = await runMonitorCheckAndEvaluate(monitor.id, { allowPrivateTargets: true });
      const eval5 = await runMonitorCheckAndEvaluate(monitor.id, { allowPrivateTargets: true });
      expect(eval4.incidentCreatedId).toBeNull();
      expect(eval5.incidentCreatedId).toBeNull();

      const openIncidentsCount = await workerPrisma.incident.count({
        where: { monitorId: monitor.id, status: { not: 'RESOLVED' } },
      });
      expect(openIncidentsCount).toBe(1);

      // 5. Verify PostgreSQL partial unique index blocks inserting a second open incident directly!
      await expect(
        workerPrisma.incident.create({
          data: {
            projectId: project.id,
            monitorId: monitor.id,
            title: 'Duplicate Race Attempt',
            status: 'INVESTIGATING',
          },
        }),
      ).rejects.toThrow();

      // 6. Service returns 200 OK: check #1 (consecutiveSuccesses=1 < recoveryThreshold=2) -> stays DOWN
      simulatedMode = 'ok';
      const rec1 = await runMonitorCheckAndEvaluate(monitor.id, { allowPrivateTargets: true });
      expect(rec1.currentStatus).toBe('DOWN');
      expect(rec1.incidentResolvedId).toBeNull();

      // 7. Service returns 200 OK: check #2 (consecutiveSuccesses=2 == recoveryThreshold) -> Auto-RESOLVED!
      const rec2 = await runMonitorCheckAndEvaluate(monitor.id, { allowPrivateTargets: true });
      expect(rec2.currentStatus).toBe('OPERATIONAL');
      expect(rec2.incidentResolvedId).toBe(firstIncidentId);

      // Wait briefly for BullMQ notification-dispatch worker to process queued emails
      const waitDeadline = Date.now() + 4000;
      while (sentEmails.length < 2 && Date.now() < waitDeadline) {
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(sentEmails.length).toBe(2);
      expect(sentEmails[0].subject).toContain('[DOWN]');
      expect(sentEmails[1].subject).toContain('[RECOVERED]');

      // Verify daily rollup row was populated accurately
      const rollups = await workerPrisma.monitorDailyRollup.findMany({
        where: { monitorId: monitor.id },
      });
      expect(rollups.length).toBe(1);
      expect(rollups[0].totalChecks).toBe(7);
      expect(rollups[0].upChecks).toBe(3);
      expect(rollups[0].downChecks).toBe(4);
    } finally {
      await notifWorker.close();
    }
  });
});
