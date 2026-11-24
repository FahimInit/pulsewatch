import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@pulsewatch/shared': path.resolve(__dirname, 'shared/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./tests/setup/global-setup.ts'],
    setupFiles: ['./tests/setup/test-env.ts'],
    include: [
      'shared/tests/**/*.test.ts',
      'server/tests/**/*.test.ts',
      'worker/tests/**/*.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
