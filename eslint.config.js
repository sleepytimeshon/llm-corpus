// eslint.config.js — flat config (ESLint 9+)
// Custom rules from tools/eslint-rules/ are wired here per T027.

import tseslint from 'typescript-eslint';
import noForbiddenNetworkImports from './tools/eslint-rules/no-forbidden-network-imports.js';
import noProcessExitInLibs from './tools/eslint-rules/no-process-exit-in-libs.js';
import pathsFromResolverOnly from './tools/eslint-rules/paths-from-resolver-only.js';
import noDirectWorkerSpawn from './tools/eslint-rules/no-direct-worker-spawn.js';
import noShellStringExec from './tools/eslint-rules/no-shell-string-exec.js';
import noWritesFromResourceHandlers from './tools/eslint-rules/no-writes-from-resource-handlers.js';

const localRulesPlugin = {
  rules: {
    'no-forbidden-network-imports': noForbiddenNetworkImports,
    'no-process-exit-in-libs': noProcessExitInLibs,
    'paths-from-resolver-only': pathsFromResolverOnly,
    'no-direct-worker-spawn': noDirectWorkerSpawn,
    'no-shell-string-exec': noShellStringExec,
    'no-writes-from-resource-handlers': noWritesFromResourceHandlers,
  },
};

export default [
  // Ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      '.specify/**',
      '.claude/**',
      '.product/**',
      'specs/**',
    ],
  },

  // Base TS recommended
  ...tseslint.configs.recommended,

  // All TypeScript source under packages/ and tools/
  {
    files: ['packages/**/*.ts', 'tools/**/*.ts', 'build/**/*.ts'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      'llm-corpus': localRulesPlugin,
    },
    rules: {
      // Custom rules — most are scoped per file pattern below; activate with sane defaults here.
      'llm-corpus/no-shell-string-exec': 'error',
    },
  },

  // NFR-001 — forbidden network imports in pipeline + adapter packages.
  // Scope: packages/{pipeline,storage,index,inference,extract,cli}.
  // OUT of scope: packages/{transport,daemon,contracts} (they host the egress hook).
  {
    files: [
      'packages/pipeline/**/*.ts',
      'packages/storage/**/*.ts',
      'packages/index/**/*.ts',
      'packages/inference/**/*.ts',
      'packages/extract/**/*.ts',
      'packages/cli/**/*.ts',
    ],
    plugins: { 'llm-corpus': localRulesPlugin },
    rules: {
      'llm-corpus/no-forbidden-network-imports': 'error',
    },
  },

  // Constitution XI — no process.exit in libraries.
  // Scope: contracts, core, storage, index, inference, extract, pipeline.
  {
    files: [
      'packages/contracts/**/*.ts',
      'packages/storage/**/*.ts',
      'packages/index/**/*.ts',
      'packages/inference/**/*.ts',
      'packages/extract/**/*.ts',
      'packages/pipeline/**/*.ts',
    ],
    plugins: { 'llm-corpus': localRulesPlugin },
    rules: {
      'llm-corpus/no-process-exit-in-libs': 'error',
    },
  },

  // Constitution XIV — paths from resolver only.
  // Scope: ALL of packages/ EXCEPT packages/contracts/src/paths.ts (the resolver itself).
  {
    files: ['packages/**/*.ts'],
    ignores: ['packages/contracts/src/paths.ts'],
    plugins: { 'llm-corpus': localRulesPlugin },
    rules: {
      'llm-corpus/paths-from-resolver-only': 'error',
    },
  },

  // NFR-002 — no direct Worker spawn outside the guard helper.
  {
    files: ['packages/**/*.ts'],
    ignores: ['packages/daemon/src/worker-spawn-guard.ts'],
    plugins: { 'llm-corpus': localRulesPlugin },
    rules: {
      'llm-corpus/no-direct-worker-spawn': 'error',
    },
  },

  // SC-010 — read-only enforcement on the MCP resource-handler call graph.
  // Scope: SP-002 resource-handler source files + their storage adapters,
  // EXTENDED in SP-006 (T015) to cover the corpus://failures handler + adapter.
  // T007 shipped the rule as a no-op skeleton; T067 filled the AST scan.
  {
    files: [
      'packages/transport/src/resource-manifest-handler.ts',
      'packages/transport/src/resource-taxonomy-handler.ts',
      'packages/transport/src/resource-recent-handler.ts',
      'packages/transport/src/resource-document-handler.ts',
      'packages/storage/src/manifest-adapter.ts',
      'packages/storage/src/taxonomy-adapter.ts',
      'packages/storage/src/recent-adapter.ts',
      'packages/storage/src/document-adapter.ts',
      // SP-006 additions:
      'packages/transport/src/failures-resource-handler.ts',
      'packages/storage/src/failures-resource-adapter.ts',
    ],
    plugins: { 'llm-corpus': localRulesPlugin },
    rules: {
      'llm-corpus/no-writes-from-resource-handlers': 'error',
    },
  },

  // Test files — relax some rules.
  // `paths-from-resolver-only` is disabled here because tests use synthetic
  // `/tmp/...` literals to drive XDG-override behavior on the Paths resolver
  // (e.g., `process.env.CORPUS_HOME = '/tmp/corpus-home'`). These are inputs
  // to the test, not real filesystem paths. Production code under packages/
  // continues to be governed by Constitution XIV.
  {
    files: ['tests/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'llm-corpus/no-forbidden-network-imports': 'off',
      'llm-corpus/no-direct-worker-spawn': 'off',
      'llm-corpus/no-process-exit-in-libs': 'off',
      'llm-corpus/paths-from-resolver-only': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // Lint fixtures — must NOT trigger lint errors during test setup.
  {
    files: ['tests/lint-fixtures/**/*.ts'],
    rules: {
      'llm-corpus/no-forbidden-network-imports': 'off',
    },
  },
];
