import fs from 'node:fs';
import path from 'node:path';

const runtimeConfigPath = path.resolve(__dirname, '../../.dev-data/test-env.json');

if (fs.existsSync(runtimeConfigPath)) {
  const cfg = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8')) as Record<string, string>;
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = cfg.DATABASE_URL;
  process.env.REDIS_URL = cfg.REDIS_URL;
  process.env.JWT_ACCESS_SECRET = cfg.JWT_ACCESS_SECRET;
  process.env.BCRYPT_ROUNDS = '4'; // Fast deterministic hashing during integration tests
}
