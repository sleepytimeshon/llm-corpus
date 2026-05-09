// T033 — Integration test: corpus://manifest handler against empty corpus.
//
// References: FR-005, US1 AS3 (canonical empty-manifest), US1 AS4 (single
// content entry), SC-004 partial (manifest empty-state), SC-009 contributory
// (one telemetry event per read).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerManifestResource } from '../../packages/transport/src/resource-manifest-handler.js';
import { ensureIndexInitialized } from '../../packages/storage/src/sqlite-open.js';
import {
  ManifestPayload,
  Paths,
  SCHEMA_VERSION,
  TAXONOMY_VERSION,
  TelemetryEvent,
} from '../../packages/contracts/src/index.js';

describe('corpus://manifest empty corpus (T033 / FR-005 / SC-004 partial)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-manifest-empty-'));
    process.env.CORPUS_HOME = tmpHome;
    // Ensure the index file + baseline schema exist before reads.
    ensureIndexInitialized();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('reads canonical empty-state manifest in single application/json content entry', async () => {
    const built = buildMcpServer({ ready: false });
    registerManifestResource(built);
    built.markReady();

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'test-client', version: '0.0.0' },
      { capabilities: {} },
    );
    await Promise.all([
      built.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const result = await client.readResource({ uri: 'corpus://manifest' });
      expect(Array.isArray(result.contents)).toBe(true);
      expect(result.contents.length).toBe(1);
      const c = result.contents[0]!;
      expect(c.uri).toBe('corpus://manifest');
      expect(c.mimeType).toBe('application/json');
      expect(typeof c.text).toBe('string');
      const payload = JSON.parse(c.text as string);
      // Validate against the Zod schema.
      const parsed = ManifestPayload.parse(payload);
      expect(parsed).toEqual({
        doc_count: 0,
        established_domains: [],
        established_tags: [],
        last_ingest_timestamp: null,
        schema_version: SCHEMA_VERSION,
        taxonomy_version: TAXONOMY_VERSION,
      });
    } finally {
      await client.close();
      await built.server.close();
    }
  });

  it('emits exactly one resource.read success event per read', async () => {
    const built = buildMcpServer({ ready: false });
    registerManifestResource(built);
    built.markReady();

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'test-client', version: '0.0.0' },
      { capabilities: {} },
    );
    await Promise.all([
      built.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const telemetryFile = Paths.telemetry();
    // Snapshot before to count delta — telemetry is append-only JSONL.
    const before = fs.existsSync(telemetryFile)
      ? fs.readFileSync(telemetryFile, 'utf8')
      : '';
    try {
      await client.readResource({ uri: 'corpus://manifest' });
    } finally {
      await client.close();
      await built.server.close();
    }
    const after = fs.existsSync(telemetryFile)
      ? fs.readFileSync(telemetryFile, 'utf8')
      : '';
    const newLines = after.slice(before.length).trim().split('\n').filter(Boolean);
    const events = newLines.map((line) => JSON.parse(line));
    const resourceReads = events.filter(
      (e) => (e as { event?: string }).event === 'resource.read',
    );
    expect(resourceReads.length).toBe(1);
    const ev = TelemetryEvent.parse(resourceReads[0]);
    if (ev.event !== 'resource.read') throw new Error('expected resource.read');
    expect(ev.resource_uri).toBe('corpus://manifest');
    expect(ev.result).toBe('success');
    expect(ev.severity).toBe('info');
    expect(ev.duration_ms).toBeGreaterThanOrEqual(0);
    expect(typeof ev.request_id).toBe('string');
    expect(ev.doc_id).toBeUndefined();
  });
});
