import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/lint-fixtures/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['packages/*/src/**/*.ts', 'tools/eslint-rules/**/*.ts', 'build/**/*.ts'],
      exclude: ['**/*.test.ts', '**/dist/**'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
