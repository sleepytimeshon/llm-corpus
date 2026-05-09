// T035 — Integration test: corpus://manifest against populated fixture.
//
// References: FR-005, populated-state coverage, contracts/resource-manifest.md
// "Populated example".
//
// Uses the documents.sql fixture (5 success rows) + taxonomy-promoted.json
// (2 promoted domains + 3 promoted tags).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerManifestResource } from '../../packages/transport/src/resource-manifest-handler.js';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import {
  ManifestPayload,
  SCHEMA_VERSION,
  TAXONOMY_VERSION,
} from '../../packages/contracts/src/index.js';

describe('corpus://manifest populated fixture (T035 / FR-005)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let osTmpDir: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // The fixture loader resolves Paths.sp002FixturesRoot() under cache.
    // We override CORPUS_HOME to a fresh temp root so the fixture root is
    // isolated from the user's actual cache.
    osTmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'corpus-manifest-populated-'),
    );
    process.env.CORPUS_HOME = osTmpDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(osTmpDir, { recursive: true, force: true });
  });

  it('returns populated manifest with sorted-ascending lists and MAX timestamp', async () => {
    // Build the fixture DB; the fixture-loader places the DB inside its
    // own subdir but we want Paths.indexDb() (which the manifest adapter
    // uses) to resolve THERE. The simplest path: load the fixture into a
    // per-test root, point CORPUS_HOME at that root, then place the DB at
    // CORPUS_HOME/data/index.db (which is what Paths.indexDb() returns).
    const handle = await loadFixture('manifest-pop', 'documents');
    try {
      // Move the fixture DB to the canonical Paths.indexDb() location.
      // The fixture-loader puts it at <rootDir>/data/index.db — same
      // location Paths.indexDb() resolves to when CORPUS_HOME=<rootDir>.
      // But the fixture root is <fixturesRoot>/<testId>; we point
      // CORPUS_HOME there.
      process.env.CORPUS_HOME = handle.rootDir;
      // Promote 2 domains + 3 tags into the same DB.
      handle.db.exec(`
        INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
        ('domain', 'devops', 'established', '2026-05-01T00:00:00Z'),
        ('domain', 'linux',  'established', '2026-05-01T00:00:00Z'),
        ('tag',    'ansible','established', '2026-05-01T00:00:00Z'),
        ('tag',    'rhel-9', 'established', '2026-05-01T00:00:00Z'),
        ('tag',    'systemd','established', '2026-05-01T00:00:00Z')
      `);

      const built = buildMcpServer({ ready: false });
      registerManifestResource(built);
      built.markReady();

      const [c, s] = InMemoryTransport.createLinkedPair();
      const client = new Client(
        { name: 'test-client', version: '0.0.0' },
        { capabilities: {} },
      );
      await Promise.all([built.server.connect(s), client.connect(c)]);

      try {
        const result = await client.readResource({ uri: 'corpus://manifest' });
        expect(result.contents.length).toBe(1);
        const payload = ManifestPayload.parse(
          JSON.parse(result.contents[0]!.text as string),
        );
        expect(payload.doc_count).toBe(5);
        expect(payload.established_domains).toEqual(['devops', 'linux']);
        expect(payload.established_tags).toEqual([
          'ansible',
          'rhel-9',
          'systemd',
        ]);
        expect(payload.last_ingest_timestamp).toBe('2026-05-15T14:30:00Z');
        expect(payload.schema_version).toBe(SCHEMA_VERSION);
        expect(payload.taxonomy_version).toBe(TAXONOMY_VERSION);
      } finally {
        await client.close();
        await built.server.close();
      }
    } finally {
      handle.cleanup();
    }
  });
});
