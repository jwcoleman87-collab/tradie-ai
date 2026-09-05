import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/live/**'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
});
