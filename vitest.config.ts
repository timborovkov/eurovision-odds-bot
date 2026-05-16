import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@/': `${path.resolve(here, 'src')}/`,
      '@config/': `${path.resolve(here, 'config')}/`,
    },
  },
  test: {
    include: ['tests/integration/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    reporters: ['default'],
    pool: 'forks',
  },
});
