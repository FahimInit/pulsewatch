import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

let pgInstance: EmbeddedPostgres | null = null;
let redisInstance: RedisMemoryServer | null = null;

const runtimeConfigPath = path.resolve(__dirname, '../../.dev-data/test-env.json');

function canConnectTcp(host: string, port: number, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(ok);
      }
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not allocate free TCP port')));
      }
    });
    srv.on('error', reject);
  });
}

export async function setup(): Promise<void> {
  fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });

  let databaseUrl = process.env.DATABASE_URL || '';
  let redisUrl = process.env.REDIS_URL || '';

  // 1. Check if external PostgreSQL is already reachable (e.g. CI or Docker Compose)
  let externalPgReady = false;
  if (databaseUrl) {
    try {
      const u = new URL(databaseUrl);
      externalPgReady = await canConnectTcp(u.hostname, Number(u.port || 5432));
    } catch {
      externalPgReady = false;
    }
  }

  if (!externalPgReady) {
    const pgPort = await getFreePort();
    const pgDataDir = path.resolve(__dirname, `../../.dev-data/pg-test-${pgPort}`);
    fs.rmSync(pgDataDir, { recursive: true, force: true });

    pgInstance = new EmbeddedPostgres({
      databaseDir: pgDataDir,
      user: 'postgres',
      password: 'pulsewatch_test_password',
      port: pgPort,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });

    await pgInstance.initialise();
    await pgInstance.start();
    await pgInstance.createDatabase('pulsewatch_test');
    databaseUrl = `postgresql://postgres:pulsewatch_test_password@127.0.0.1:${pgPort}/pulsewatch_test?schema=public`;
  }

  // 2. Check if external Redis is already reachable (e.g. CI or Docker Compose)
  let externalRedisReady = false;
  if (redisUrl) {
    try {
      const u = new URL(redisUrl);
      externalRedisReady = await canConnectTcp(u.hostname, Number(u.port || 6379));
    } catch {
      externalRedisReady = false;
    }
  }

  if (!externalRedisReady) {
    redisInstance = new RedisMemoryServer();
    const host = await redisInstance.getHost();
    const port = await redisInstance.getPort();
    redisUrl = `redis://${host}:${port}`;
  }

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.JWT_ACCESS_SECRET =
    process.env.JWT_ACCESS_SECRET || 'vitest-access-secret-key-minimum-32-characters-long';

  // Apply Prisma migrations to the real PostgreSQL test database
  execSync('npx prisma migrate deploy --schema=prisma/schema.prisma', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  fs.writeFileSync(
    runtimeConfigPath,
    JSON.stringify(
      {
        DATABASE_URL: databaseUrl,
        REDIS_URL: redisUrl,
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
      },
      null,
      2,
    ),
    'utf8',
  );
}

export async function teardown(): Promise<void> {
  if (redisInstance) {
    try {
      await redisInstance.stop();
    } catch {
      // ignore cleanup error
    }
  }
  if (pgInstance) {
    try {
      await pgInstance.stop();
    } catch {
      // ignore cleanup error
    }
  }
  try {
    fs.rmSync(runtimeConfigPath, { force: true });
  } catch {
    // ignore
  }
}
