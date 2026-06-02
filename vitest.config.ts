import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
    benchmark: {
      include: ['test/**/*.bench.ts'],
    },
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts'],
      exclude: ['src/main/db/**', 'src/main/window.ts'],
    },
  },
});
