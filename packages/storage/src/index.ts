// @llm-corpus/storage — read-only storage adapters for SP-002 MCP resources.
//
// SP-001 shipped this package as a stub. SP-002 grows it with:
//   - sqlite-open.ts        — read-only WAL handle
//   - schema-migration.ts   — empty-baseline `documents` + `taxonomy_terms`
//   - config-loader.ts      — config.toml reader for resource knobs
//
// SP-002 also ships `fixtures.ts` (test-only) — NOT exported here. Tests
// import the fixture-loader by direct file path
// (`packages/storage/src/fixtures.ts`); production code MUST NOT.

export * from './sqlite-open.js';
export * from './schema-migration.js';
export * from './config-loader.js';
export * from './manifest-adapter.js';
export * from './taxonomy-adapter.js';
export * from './document-adapter.js';
export * from './document-writer.js';
export * from './recent-adapter.js';
export * from './unique-hash-migration.js';
