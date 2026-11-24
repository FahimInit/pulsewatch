import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const demoEmail = 'john@example.com';
  const existing = await prisma.user.findUnique({ where: { email: demoEmail } });
  if (existing) {
    console.log('[seed] Demo account john@example.com already exists; skipping seed.');
    return;
  }

  const passwordHash = await bcrypt.hash('Password123', 10);

  const user = await prisma.user.create({
    data: {
      name: 'John Developer',
      email: demoEmail,
      passwordHash,
      timezone: 'UTC',
    },
  });

  const project = await prisma.project.create({
    data: {
      name: 'Developer Workspace',
      slug: 'developer-workspace',
      description: 'Core production APIs and customer-facing web infrastructure',
      planTier: 'FREE',
      monitorLimit: 20,
      members: {
        create: {
          userId: user.id,
          role: 'OWNER',
        },
      },
      alertRules: {
        create: [
          {
            name: 'Incident Outage Alert',
            triggerType: 'INCIDENT_CREATED',
            channels: ['IN_APP', 'EMAIL'],
            recipientEmails: [demoEmail],
            cooldownMinutes: 10,
          },
          {
            name: 'Service Recovery Alert',
            triggerType: 'INCIDENT_RESOLVED',
            channels: ['IN_APP', 'EMAIL'],
            recipientEmails: [demoEmail],
            cooldownMinutes: 1,
          },
          {
            name: 'High Response Time > 750ms',
            triggerType: 'HIGH_LATENCY',
            thresholdValue: 750,
            channels: ['IN_APP'],
            recipientEmails: [],
            cooldownMinutes: 15,
          },
        ],
      },
    },
  });

  const now = new Date();

  const monitors = await Promise.all([
    prisma.monitor.create({
      data: {
        projectId: project.id,
        name: 'Production API',
        url: 'https://www.cloudflare.com/cdn-cgi/trace',
        method: 'GET',
        expectedStatusCodes: [200],
        intervalSeconds: 60,
        timeoutMs: 10000,
        degradedThresholdMs: 900,
        status: 'OPERATIONAL',
        lastCheckedAt: new Date(now.getTime() - 30_000),
        lastResponseTimeMs: 124,
        createdById: user.id,
      },
    }),
    prisma.monitor.create({
      data: {
        projectId: project.id,
        name: 'Main Website',
        url: 'https://example.com',
        method: 'GET',
        expectedStatusCodes: [200],
        intervalSeconds: 60,
        timeoutMs: 10000,
        degradedThresholdMs: 900,
        status: 'OPERATIONAL',
        lastCheckedAt: new Date(now.getTime() - 45_000),
        lastResponseTimeMs: 89,
        createdById: user.id,
      },
    }),
    prisma.monitor.create({
      data: {
        projectId: project.id,
        name: 'GitHub Status API',
        url: 'https://www.githubstatus.com/api/v2/status.json',
        method: 'GET',
        expectedStatusCodes: [200],
        keyword: 'Indicator',
        keywordMatchType: 'NOT_CONTAINS',
        intervalSeconds: 120,
        timeoutMs: 10000,
        degradedThresholdMs: 700,
        status: 'DEGRADED',
        lastCheckedAt: new Date(now.getTime() - 20_000),
        lastResponseTimeMs: 742,
        createdById: user.id,
      },
    }),
    prisma.monitor.create({
      data: {
        projectId: project.id,
        name: 'NPM Registry Ping',
        url: 'https://registry.npmjs.org/-/ping',
        method: 'GET',
        expectedStatusCodes: [200],
        intervalSeconds: 60,
        timeoutMs: 10000,
        degradedThresholdMs: 900,
        status: 'OPERATIONAL',
        lastCheckedAt: new Date(now.getTime() - 50_000),
        lastResponseTimeMs: 105,
        createdById: user.id,
      },
    }),
  ]);

  // Seed 24h hourly telemetry results & 14d daily rollups
  const resultRows = [];
  for (let h = 23; h >= 0; h--) {
    const ts = new Date(now.getTime() - h * 60 * 60 * 1000);
    for (const [idx, mon] of monitors.entries()) {
      const baseMs = idx === 2 ? 220 : 95 + idx * 18;
      const jitter = ((h * 17 + idx * 31) % 55) - 20;
      const responseTimeMs = Math.max(45, baseMs + jitter);
      resultRows.push({
        monitorId: mon.id,
        checkedAt: ts,
        status: responseTimeMs > mon.degradedThresholdMs ? ('DEGRADED' as const) : ('OPERATIONAL' as const),
        statusCode: 200,
        responseTimeMs,
        dnsTimeMs: 12,
        connectTimeMs: 28,
        ttfbMs: responseTimeMs - 8,
        responseSizeBytes: 512,
      });
    }
  }
  await prisma.monitoringResult.createMany({ data: resultRows });

  for (let d = 13; d >= 0; d--) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d));
    for (const mon of monitors) {
      await prisma.monitorDailyRollup.create({
        data: {
          monitorId: mon.id,
          day,
          totalChecks: 1440,
          upChecks: d === 4 && mon.id === monitors[2].id ? 1435 : 1440,
          degradedChecks: 0,
          downChecks: d === 4 && mon.id === monitors[2].id ? 5 : 0,
          avgLatencyMs: 132,
          minLatencyMs: 74,
          maxLatencyMs: 390,
        },
      });
    }
  }

  // Create one sample active monitoring incident + one resolved incident
  await prisma.incident.create({
    data: {
      projectId: project.id,
      monitorId: monitors[2].id,
      title: 'Elevated Upstream Response Latency',
      summary: 'P95 response latency exceeded 700ms degraded threshold.',
      severity: 'MEDIUM',
      status: 'MONITORING',
      triggerReason: 'HIGH_LATENCY',
      startedAt: new Date(now.getTime() - 35 * 60 * 1000),
      acknowledgedAt: new Date(now.getTime() - 25 * 60 * 1000),
      acknowledgedById: user.id,
      events: {
        create: [
          {
            type: 'DETECTED',
            message: 'Latency exceeded configured threshold (742 ms > 700 ms).',
            createdAt: new Date(now.getTime() - 35 * 60 * 1000),
          },
          {
            actorId: user.id,
            type: 'ACKNOWLEDGED',
            message: 'John Developer acknowledged the incident and is observing edge POP routing.',
            createdAt: new Date(now.getTime() - 25 * 60 * 1000),
          },
        ],
      },
    },
  });

  await prisma.statusPage.create({
    data: {
      projectId: project.id,
      name: 'Pulsewatch Demo Status',
      slug: 'developer-workspace',
      description: 'Public system status and 90-day historical availability',
      isPublic: true,
      showUptimeHistory: true,
      showIncidents: true,
      monitors: {
        create: monitors.map((m, idx) => ({
          monitorId: m.id,
          displayName: m.name,
          groupName: 'Core Platform',
          sortOrder: idx,
        })),
      },
    },
  });

  console.log('[seed] Seeded demo account: john@example.com / Password123');
}

main()
  .catch((err) => {
    console.error('[seed] Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
