// T042 — Integration test: corpus://taxonomy promoted-only filter.
//
// References: FR-006, US2 AS1, US2 AS2, SC-005 (Constitution XV exclusion),
// contracts/resource-taxonomy.md.
//
// Loads the documents.sql + taxonomy-mixed fixture (5 established + 2
// proposed), reads via MCP, asserts proposed terms are absent.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerTaxonomyResource } from '../../packages/transport/src/resource-taxonomy-handler.js';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import { TaxonomyPayload } from '../../packages/contracts/src/index.js';

describe('corpus://taxonomy promoted-only filter (T042 / SC-005)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let osTmpDir: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    osTmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'corpus-taxonomy-mixed-'),
    );
    process.env.CORPUS_HOME = osTmpDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(osTmpDir, { recursive: true, force: true });
  });

  it('hides proposed taxonomy terms from the response', async () => {
    const handle = await loadFixture('taxonomy-mixed-int', 'documents');
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      // Insert mixed taxonomy state (matches taxonomy-mixed.json fixture).
      handle.db.exec(`
        INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
        ('domain', 'devops', 'established', '2026-05-01T00:00:00Z'),
        ('domain', 'linux',  'established', '2026-05-01T00:00:00Z'),
        ('tag',    'ansible','established', '2026-05-01T00:00:00Z'),
        ('tag',    'rhel-9', 'established', '2026-05-01T00:00:00Z'),
        ('tag',    'systemd','established', '2026-05-01T00:00:00Z'),
        ('tag',    'PROPOSED-tag-a', 'proposed', NULL),
        ('tag',    'PROPOSED-tag-b', 'proposed', NULL)
      `);

      const built = buildMcpServer({ ready: false });
      registerTaxonomyResource(built);
      built.markReady();

      const [c, s] = InMemoryTransport.createLinkedPair();
      const client = new Client(
        { name: 'test-client', version: '0.0.0' },
        { capabilities: {} },
      );
      await Promise.all([built.server.connect(s), client.connect(c)]);

      try {
        const result = await client.readResource({ uri: 'corpus://taxonomy' });
        const payload = TaxonomyPayload.parse(
          JSON.parse(result.contents[0]!.text as string),
        );
        // Domains: 2 promoted.
        expect(payload.domains.map((t) => t.term)).toEqual(['devops', 'linux']);
        // Tags: ONLY the 3 promoted.
        expect(payload.tags.map((t) => t.term)).toEqual([
          'ansible',
          'rhel-9',
          'systemd',
        ]);
        // Proposed tags absent from ALL four axes.
        const allTerms = [
          ...payload.domains,
          ...payload.tags,
          ...payload.types,
          ...payload.source_types,
        ].map((t) => t.term);
        expect(allTerms).not.toContain('PROPOSED-tag-a');
        expect(allTerms).not.toContain('PROPOSED-tag-b');
        // Document counts non-negative integers (uses fixture rows).
        for (const t of payload.tags) {
          expect(Number.isInteger(t.document_count)).toBe(true);
          expect(t.document_count).toBeGreaterThanOrEqual(0);
        }
      } finally {
        await client.close();
        await built.server.close();
      }
    } finally {
      handle.cleanup();
    }
  });
});
