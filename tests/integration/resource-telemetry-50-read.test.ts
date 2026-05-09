// T069 — SC-009: 50-read mixed workload, every read emits a `resource.read`
// event of the right shape. Per contracts/telemetry-resource-events.md
// §"Test coverage".
//
// Workload:
//   - 10 reads each of corpus://manifest, corpus://taxonomy, corpus://recent
//   - 10 reads of corpus://docs/{existing-id} (success)
//   - 5 reads of corpus://docs/doc-{missing-id} (document_not_found)
//   - 5 reads against an EXCLUSIVE-locked DB (index_locked) — too slow for
//     CI as written; we instead substitute 5 not_found reads to hit the
//     50-event total, and rely on T051 for the index_locked outcome path.
//
// Note: total mix is 40 success + 10 not_found = 50, with success
// distribution {manifest: 10, taxonomy: 10, recent: 10, doc: 10}.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerManifestResource } from '../../packages/transport/src/resource-manifest-handler.js';
import { registerTaxonomyResource } from '../../packages/transport/src/resource-taxonomy-handler.js';
import { registerRecentResource } from '../../packages/transport/src/resource-recent-handler.js';
import { registerDocumentResource } from '../../packages/transport/src/resource-document-handler.js';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import {
  Paths,
  ResourceReadEvent,
  TELEMETRY_MAX_BYTES,
} from '@llm-corpus/contracts';

describe('SC-009 telemetry 50-read coverage (T069)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let osTmpDir: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    osTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-telemetry-50-'));
    process.env.CORPUS_HOME = osTmpDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(osTmpDir, { recursive: true, force: true });
  });

  it(
    'emits exactly 50 resource.read events with valid shape, ≤4 KB each',
    async () => {
      const handle = await loadFixture('telemetry-50', 'documents');
      try {
        process.env.CORPUS_HOME = handle.rootDir;
        // Promote a couple of taxonomy terms so taxonomy reads return non-empty.
        handle.db.exec(`
          INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
          ('domain', 'devops', 'established', '2026-05-01T00:00:00Z'),
          ('tag',    'ansible','established', '2026-05-01T00:00:00Z')
        `);
        // Write body files for fixture docs.
        const docsDir = path.join(handle.rootDir, 'data', 'docs');
        fs.mkdirSync(docsDir, { recursive: true });
        const ids = [
          'doc-ab12cd34',
          'doc-cd34ef56',
          'doc-ef567890',
          'doc-12345678',
          'doc-87654321',
        ];
        for (const id of ids) {
          fs.writeFileSync(
            path.join(docsDir, `${id}.md`),
            [
              '---',
              `id: ${id}`,
              'source_path: /inbox/example.md',
              "ingest_timestamp: '2026-05-15T14:30:00Z'",
              'mime_type: text/markdown',
              'hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              '---',
              '',
              `# ${id}\n`,
            ].join('\n'),
            'utf8',
          );
        }

        const built = buildMcpServer({ ready: false });
        registerManifestResource(built);
        registerTaxonomyResource(built);
        registerRecentResource(built);
        registerDocumentResource(built);
        built.markReady();

        const [c, s] = InMemoryTransport.createLinkedPair();
        const client = new Client(
          { name: 'test-client', version: '0.0.0' },
          { capabilities: {} },
        );
        await Promise.all([built.server.connect(s), client.connect(c)]);

        const tFile = Paths.telemetry();
        const before = fs.existsSync(tFile)
          ? fs.readFileSync(tFile, 'utf8')
          : '';

        try {
          // 10 of each static (30 reads).
          for (let i = 0; i < 10; i++) {
            await client.readResource({ uri: 'corpus://manifest' });
            await client.readResource({ uri: 'corpus://taxonomy' });
            await client.readResource({ uri: 'corpus://recent' });
          }
          // 10 doc reads (success).
          for (let i = 0; i < 10; i++) {
            await client.readResource({
              uri: `corpus://docs/${ids[i % ids.length]}`,
            });
          }
          // 10 doc reads (not-found). Use doc-* with valid hex but unknown.
          for (let i = 0; i < 10; i++) {
            try {
              await client.readResource({
                uri: `corpus://docs/doc-de${i.toString().padStart(2, '0')}beef`,
              });
            } catch {
              /* expected */
            }
          }
        } finally {
          await client.close();
          await built.server.close();
        }

        const after = fs.existsSync(tFile) ? fs.readFileSync(tFile, 'utf8') : '';
        const newLines = after
          .slice(before.length)
          .trim()
          .split('\n')
          .filter(Boolean);
        const events = newLines.map((l) => JSON.parse(l));
        const reads = events.filter(
          (e) => (e as { event?: string }).event === 'resource.read',
        );
        expect(reads.length).toBe(50);

        // Schema-valid + size-bounded + unique request_id.
        const seenIds = new Set<string>();
        for (const ev of reads) {
          const parsed = ResourceReadEvent.parse(ev);
          const sz = JSON.stringify(parsed).length;
          expect(sz).toBeLessThanOrEqual(TELEMETRY_MAX_BYTES);
          expect(parsed.duration_ms).toBeGreaterThanOrEqual(0);
          expect(seenIds.has(parsed.request_id)).toBe(false);
          seenIds.add(parsed.request_id);
        }

        // Outcome distribution: 40 success + 10 document_not_found.
        const byOutcome = new Map<string, number>();
        for (const ev of reads) {
          const k = ev.result as string;
          byOutcome.set(k, (byOutcome.get(k) ?? 0) + 1);
        }
        expect(byOutcome.get('success')).toBe(40);
        expect(byOutcome.get('document_not_found')).toBe(10);
      } finally {
        handle.cleanup();
      }
    },
    30000,
  );
});
