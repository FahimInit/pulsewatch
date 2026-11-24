import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_APP_URL: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  REFRESH_COOKIE_NAME: z.string().default('pw_refresh_token'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  ALLOW_PRIVATE_MONITOR_TARGETS: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cachedEnv: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (!cachedEnv || process.env.NODE_ENV === 'test') {
    cachedEnv = envSchema.parse(process.env);
  }
  return cachedEnv;
}
