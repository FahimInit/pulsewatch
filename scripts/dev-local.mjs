import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function canConnectTcp(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok) => {
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

async function main() {
  let pg = null;
  let redis = null;

  let databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://pulsewatch:pulsewatch_dev_password@127.0.0.1:5432/pulsewatch?schema=public';
  let redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  const pgUp = await canConnectTcp('127.0.0.1', 5432);
  if (!pgUp) {
    const pgDir = path.join(rootDir, '.dev-data', 'postgres-dev');
    const isInitialised = fs.existsSync(path.join(pgDir, 'PG_VERSION'));
    pg = new EmbeddedPostgres({
      databaseDir: pgDir,
      user: 'postgres',
      password: 'pulsewatch_dev_password',
      port: 5433,
      persistent: true,
    });
    if (!isInitialised) {
      console.log('[dev:local] Initialising embedded PostgreSQL 16 data directory...');
      await pg.initialise();
    }
    console.log('[dev:local] Starting embedded PostgreSQL 16 on 127.0.0.1:5433...');
    await pg.start();
    if (!isInitialised) {
      await pg.createDatabase('pulsewatch');
    }
    databaseUrl = 'postgresql://postgres:pulsewatch_dev_password@127.0.0.1:5433/pulsewatch?schema=public';
  }

  const redisUp = await canConnectTcp('127.0.0.1', 6379);
  if (!redisUp) {
    console.log('[dev:local] Starting embedded Redis server...');
    redis = new RedisMemoryServer({ instance: { port: 6379 } });
    const host = await redis.getHost();
    const port = await redis.getPort();
    redisUrl = `redis://${host}:${port}`;
  }

  const childEnv = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    JWT_ACCESS_SECRET:
      process.env.JWT_ACCESS_SECRET || 'pulsewatch-dev-jwt-secret-minimum-32-chars',
  };

  console.log('[dev:local] Applying Prisma migrations...');
  execSync('npx prisma migrate deploy --schema=prisma/schema.prisma', {
    cwd: rootDir,
    env: childEnv,
    stdio: 'inherit',
  });

  console.log('[dev:local] Running database seed (idempotent)...');
  execSync('npx tsx prisma/seed.ts', {
    cwd: rootDir,
    env: childEnv,
    stdio: 'inherit',
  });

  console.log('[dev:local] Launching Pulsewatch server, worker, and client...');
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: rootDir,
    env: childEnv,
    stdio: 'inherit',
    shell: true,
  });

  const shutdown = async () => {
    proc.kill('SIGTERM');
    if (redis) await redis.stop().catch(() => {});
    if (pg) await pg.stop().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[dev:local] Fatal error:', err);
  process.exit(1);
});
