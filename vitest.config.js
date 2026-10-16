import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['tests/setup-env.js'],
    fileParallelism: false, // test files share one database
    hookTimeout: 120000,
    testTimeout: 30000,
  },
});
