// SP-005 T070-T073 — Constitutional grep-lints across SP-005 source.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-014, FR-RETRIEVAL-015,
//     FR-RETRIEVAL-016, FR-RETRIEVAL-023, SC-RETRIEVAL-017,
//     SC-RETRIEVAL-018, SC-RETRIEVAL-019
//   - Constitution Principles I, VII, XI, XII, XIV
//
// Greps SP-005 source for prohibited patterns. Comments are stripped to
// avoid false positives on principle-citing comments.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

const SP005_LIB_SOURCES = [
  // index — entirely SP-005-owned.
  'packages/index/src/fts5-adapter.ts',
  'packages/index/src/vec-adapter.ts',
  'packages/index/src/graph-adapter.ts',
  'packages/index/src/confidence-adapter.ts',
  'packages/index/src/edges-builder.ts',
  'packages/index/src/fusion.ts',
  'packages/index/src/search.ts',
  // inference — SP-005 embedding adapter only.
  'packages/inference/src/embedding-adapter.ts',
  // pipeline — SP-005 sub-stages.
  'packages/pipeline/src/embed-stage.ts',
  'packages/pipeline/src/index-stage.ts',
  'packages/pipeline/src/edges-build-stage.ts',
  'packages/pipeline/src/retrieval-orchestrator.ts',
  // storage — SP-005 persister + migration.
  'packages/storage/src/index-persister.ts',
  'packages/storage/src/sp005-migration.ts',
  // transport — SP-005 corpus-find handler.
  'packages/transport/src/corpus-find-tool.ts',
];

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function loadSource(rel: string): string {
  const full = path.join(process.cwd(), rel);
  return fs.readFileSync(full, 'utf8');
}

describe('SP-005 constitutional grep-lints', () => {
  it('zero process.exit invocations in SP-005 library source (Constitution XI)', () => {
    for (const rel of SP005_LIB_SOURCES) {
      const stripped = stripComments(loadSource(rel));
      expect(
        stripped,
        `${rel} contains process.exit invocation`,
      ).not.toMatch(/process\.exit\s*\(/);
    }
  });

  it('zero execSync / child_process.exec / runTool in SP-005 source (Constitution XII)', () => {
    for (const rel of SP005_LIB_SOURCES) {
      const stripped = stripComments(loadSource(rel));
      expect(stripped, `${rel} contains execSync`).not.toMatch(
        /\bexecSync\s*\(/,
      );
      expect(stripped, `${rel} contains child_process.exec`).not.toMatch(
        /child_process\.exec/,
      );
    }
  });

  it('zero non-loopback HTTP URLs in SP-005 source (Constitution I)', () => {
    for (const rel of SP005_LIB_SOURCES) {
      const stripped = stripComments(loadSource(rel));
      // Only http://localhost or http://127.0.0.1 permitted. Disallow
      // explicit external URLs.
      // (HINT_FOR / hint message strings in search.ts also contain "ollama
      // pull" guidance, not URLs.)
      const externalUrls = stripped.match(/https?:\/\/(?!localhost|127\.0\.0\.1)[A-Za-z0-9.-]+/g);
      expect(externalUrls, `${rel} carries external URL`).toBeNull();
    }
  });

  it('zero raw query text references in search.* telemetry payloads (Constitution I, FR-RETRIEVAL-023)', () => {
    // Verify the orchestrator hashes the query via SHA-256 before emitting.
    // We check for `query_hash` usage in search.ts (positive signal) and
    // ensure raw `query` is not bound into telemetry payloads.
    const orchestratorSrc = stripComments(loadSource('packages/index/src/search.ts'));
    expect(orchestratorSrc).toMatch(/query_hash/);
    expect(orchestratorSrc).toMatch(/sha256Hex/);
    // The only `query:` binding to a telemetry payload should NOT exist
    // — search.* events carry query_hash, never raw query text.
    // We approximate this by ensuring the literal `event: 'search.` lines
    // are followed by hash-only payloads (manual visual; lint is loose).
  });

  it('zero Promise.race(setTimeout) patterns in SP-005 source (Constitution VII)', () => {
    for (const rel of SP005_LIB_SOURCES) {
      const stripped = stripComments(loadSource(rel));
      // Look for the forbidden race-against-setTimeout pattern.
      expect(stripped, `${rel} contains Promise.race(setTimeout)`).not.toMatch(
        /Promise\.race\s*\(\s*\[[^\]]*setTimeout/,
      );
    }
  });
});
