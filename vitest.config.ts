import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/contract/**/*.test.ts',
      'tests/lint-fixtures/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      // SP-007 T050 — C-046 smoke harness lives next to the CLI package so
      // it can resolve the dist binary via a relative path.
      'packages/*/test/**/*.test.ts',
    ],
    // Per-test-file CORPUS_HOME isolation. Each vitest worker gets a unique
    // tmpdir-rooted CORPUS_HOME so parallel test files do not race on
    // `Paths.pilotTelemetry()` / `Paths.telemetry()` writes. Tests that need
    // to assert default-$HOME behavior override this in their own
    // beforeEach/beforeAll (see tests/unit/paths.test.ts).
    setupFiles: ['./tests/_setup/per-file-corpus-home.ts'],
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
