import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@tactical/shared/bot-api': resolve(__dirname, 'packages/shared/src/bot-api.ts'),
      '@tactical/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@tactical/bots': resolve(__dirname, 'packages/bots/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    pool: 'forks',
  },
});
