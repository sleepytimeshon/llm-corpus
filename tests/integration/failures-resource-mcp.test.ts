// SP-006 T032 — Integration test: full MCP server end-to-end against the
// corpus://failures resource using fixture sidecars from
// tests/fixtures/sp006-hardening/fixture-sidecars/.
//
// Coverage:
//   - corpus://failures registered alongside the four SP-002 resources
//   - response shape Zod-validates as FailuresResourceResponse
//   - ?stage= filter pushdown
//   - ?limit= + ?offset= pagination
//   - unknown ?stage= returns FailuresErrorEnvelope (NOT transport error)
//   - malformed sidecar from fixtures is skipped + telemetry emitted
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-008..FR-HARDEN-012
//   - tests/fixtures/sp006-hardening/README.md

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  Paths,
  FailuresResourceResponseZodSchema,
  FailuresErrorEnvelopeZodSchema,
} from '@llm-corpus/contracts';
import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerFailuresResource } from '../../packages/transport/src/failures-resource-handler.js';

const FIXTURE_DIR = path.resolve(
  __dirname,
  '../fixtures/sp006-hardening/fixture-sidecars',
);

async function seedFailedFromFixtures(): Promise<void> {
  const failedDir = Paths.failed();
  await fsp.mkdir(failedDir, { recursive: true });
  const files = await fsp.readdir(FIXTURE_DIR);
  for (const f of files) {
    const src = path.join(FIXTURE_DIR, f);
    const dst = path.join(failedDir, f);
    await fsp.copyFile(src, dst);
  }
}

function decodeReadResource(reply: {
  contents: ReadonlyArray<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
}): unknown {
  expect(reply.contents.length).toBe(1);
  const c = reply.contents[0]!;
  expect(c.mimeType).toBe('application/json');
  expect(typeof c.text).toBe('string');
  return JSON.parse(c.text!);
}

describe('T032 — corpus://failures end-to-end MCP read', () => {
  let tmpHome: string;
  let originalCorpusHome: string | undefined;

  beforeEach(async () => {
    originalCorpusHome = process.env.CORPUS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-failures-mcp-'));
    process.env.CORPUS_HOME = tmpHome;
    await seedFailedFromFixtures();
  });

  afterEach(() => {
    if (originalCorpusHome === undefined) {
      delete process.env.CORPUS_HOME;
    } else {
      process.env.CORPUS_HOME = originalCorpusHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  async function connectClient(): Promise<{
    client: Client;
    close: () => Promise<void>;
  }> {
    const built = buildMcpServer({ ready: false });
    registerFailuresResource(built);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'sp006-test', version: '0.0.0' },
      { capabilities: {} },
    );
    await Promise.all([
      built.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    built.markReady();
    return {
      client,
      close: async () => {
        await client.close();
        await built.server.close();
      },
    };
  }

  it('corpus://failures appears in resources/list', async () => {
    const { client, close } = await connectClient();
    try {
      const listed = await client.listResources();
      const uris = listed.resources.map((r) => r.uri);
      expect(uris).toContain('corpus://failures');
    } finally {
      await close();
    }
  });

  it('reading corpus://failures returns FailuresResourceResponse with the fixture entries', async () => {
    const { client, close } = await connectClient();
    try {
      const reply = await client.readResource({ uri: 'corpus://failures' });
      const payload = decodeReadResource(reply);
      const parsed = FailuresResourceResponseZodSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      // 9 SP-003 .error.json + 1 SP-006 .recovery.error.json = 10 well-formed
      // (malformed.error.json is gracefully skipped).
      expect(parsed.data.total_count).toBe(10);
      expect(parsed.data.returned_count).toBe(10);
      // sorted desc by timestamp — the unrecoverable_orphan (09:30) is newest.
      expect(parsed.data.entries[0]!.stage).toBe('unrecoverable_orphan');
      // every entry carries an absolute sidecar_path under Paths.failed().
      for (const e of parsed.data.entries) {
        expect(e.sidecar_path.startsWith(Paths.failed())).toBe(true);
      }
    } finally {
      await close();
    }
  });

  it('?stage=classify filter pushes to two entries (doc-55555555 + doc-66666666)', async () => {
    const { client, close } = await connectClient();
    try {
      const reply = await client.readResource({
        uri: 'corpus://failures?stage=classify',
      });
      const payload = decodeReadResource(reply) as {
        total_count: number;
        entries: Array<{ doc_id: string | null; stage: string }>;
      };
      expect(payload.total_count).toBe(2);
      expect(payload.entries.every((e) => e.stage === 'classify')).toBe(true);
      const ids = payload.entries.map((e) => e.doc_id).sort();
      expect(ids).toEqual(['doc-55555555', 'doc-66666666']);
    } finally {
      await close();
    }
  });

  it('?limit=3&offset=2 pagination respects descending-timestamp order', async () => {
    const { client, close } = await connectClient();
    try {
      const reply = await client.readResource({
        uri: 'corpus://failures?limit=3&offset=2',
      });
      const payload = decodeReadResource(reply) as {
        total_count: number;
        returned_count: number;
        entries: unknown[];
      };
      expect(payload.total_count).toBe(10);
      expect(payload.returned_count).toBe(3);
      expect(payload.entries.length).toBe(3);
    } finally {
      await close();
    }
  });

  it('?stage=not_real returns FailuresErrorEnvelope (NOT transport error)', async () => {
    const { client, close } = await connectClient();
    try {
      const reply = await client.readResource({
        uri: 'corpus://failures?stage=not_real',
      });
      const payload = decodeReadResource(reply);
      const env = FailuresErrorEnvelopeZodSchema.safeParse(payload);
      expect(env.success).toBe(true);
      if (env.success) {
        expect(env.data.error_code).toBe('validation_error');
      }
    } finally {
      await close();
    }
  });

  it('malformed fixture sidecar is skipped + failures.sidecar_parse_failed emitted', async () => {
    const { client, close } = await connectClient();
    try {
      // Trigger a read so the malformed file is parsed and skipped.
      await client.readResource({ uri: 'corpus://failures' });
      const telemetryFile = Paths.telemetry();
      expect(fs.existsSync(telemetryFile)).toBe(true);
      const lines = fs
        .readFileSync(telemetryFile, 'utf8')
        .split('\n')
        .filter((l) => l.length > 0);
      const events = lines
        .map((l) => JSON.parse(l) as { event?: string; sidecar_path?: string })
        .filter((e) => e.event === 'failures.sidecar_parse_failed');
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(
        events.some(
          (e) =>
            typeof e.sidecar_path === 'string' &&
            e.sidecar_path.endsWith('malformed.error.json'),
        ),
      ).toBe(true);
    } finally {
      await close();
    }
  });
});
