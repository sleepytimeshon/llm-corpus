// SP-006 T031 — Unit test for the corpus://failures MCP resource handler.
//
// RED-phase coverage (Engineer #3 / Phase 4):
//   - Parses URI query parameters (?stage=, ?since=, ?limit=, ?offset=)
//   - Validates via FailuresQueryZodSchema
//   - Delegates to readFailuresEntries on success
//   - On validation failure (unknown stage / out-of-range limit / unknown key)
//     returns FailuresErrorEnvelope (`error_code: 'validation_error'`) inside
//     the MCP `{contents: [{...text: JSON.stringify(envelope)}]}` shape — NOT
//     a transport-level error
//   - On missing Paths.failed() returns the graceful-empty success response
//   - Emits resource.read telemetry on success and on validation failure
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-008, FR-HARDEN-010
//   - specs/006-hardening/contracts/adr-failures-resource.md "Read Algorithm"
//   - Constitution Principles III (read-only), V, XIII

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  Paths,
  FailuresResourceResponseZodSchema,
  FailuresErrorEnvelopeZodSchema,
} from '@llm-corpus/contracts';
import { failuresResourceHandler } from '../../packages/transport/src/failures-resource-handler.js';

async function seedSidecar(filename: string, json: unknown): Promise<void> {
  const dir = Paths.failed();
  await fsp.mkdir(dir, { recursive: true });
  const p = path.join(dir, filename);
  await fsp.writeFile(p, JSON.stringify(json, null, 2), 'utf8');
}

function entry(doc: string, stage: string, ts: string): unknown {
  return {
    doc_id: doc,
    stage,
    error_code: 'persist_failed',
    message: 'synthetic',
    timestamp: ts,
    retriable: false,
  };
}

interface HandlerResult {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}

function decodeText(result: HandlerResult): unknown {
  expect(result.contents.length).toBe(1);
  expect(result.contents[0]!.mimeType).toBe('application/json');
  return JSON.parse(result.contents[0]!.text);
}

describe('T031 — failuresResourceHandler (US2 P1)', () => {
  let tmpHome: string;
  let originalCorpusHome: string | undefined;

  beforeEach(() => {
    originalCorpusHome = process.env.CORPUS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-failures-handler-'));
    process.env.CORPUS_HOME = tmpHome;
  });

  afterEach(() => {
    if (originalCorpusHome === undefined) {
      delete process.env.CORPUS_HOME;
    } else {
      process.env.CORPUS_HOME = originalCorpusHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns graceful empty FailuresResourceResponse when Paths.failed() is absent', async () => {
    const ac = new AbortController();
    const result = (await failuresResourceHandler(
      'corpus://failures',
      ac.signal,
    )) as HandlerResult;
    const payload = decodeText(result);
    const parsed = FailuresResourceResponseZodSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.entries).toEqual([]);
      expect(parsed.data.total_count).toBe(0);
      expect(parsed.data.returned_count).toBe(0);
      expect(parsed.data.schema_version).toBe(1);
    }
    expect(result.contents[0]!.uri).toBe('corpus://failures');
  });

  it('parses ?stage= and applies the filter', async () => {
    await seedSidecar(
      'a.error.json',
      entry('doc-aaaaaaaa', 'classify', '2026-05-13T08:00:00Z'),
    );
    await seedSidecar(
      'b.error.json',
      entry('doc-bbbbbbbb', 'embed', '2026-05-13T08:01:00Z'),
    );
    const ac = new AbortController();
    const result = (await failuresResourceHandler(
      'corpus://failures?stage=classify',
      ac.signal,
    )) as HandlerResult;
    const payload = decodeText(result) as { total_count: number; entries: Array<{ stage: string }> };
    expect(payload.total_count).toBe(1);
    expect(payload.entries[0]!.stage).toBe('classify');
  });

  it('parses ?limit= and ?offset= as integers', async () => {
    for (let i = 0; i < 5; i++) {
      await seedSidecar(
        `doc-${i}.error.json`,
        entry(
          `doc-${i.toString(16).padStart(8, '0')}`,
          'classify',
          `2026-05-13T08:0${i}:00Z`,
        ),
      );
    }
    const ac = new AbortController();
    const result = (await failuresResourceHandler(
      'corpus://failures?limit=2&offset=1',
      ac.signal,
    )) as HandlerResult;
    const payload = decodeText(result) as {
      total_count: number;
      returned_count: number;
      entries: unknown[];
    };
    expect(payload.total_count).toBe(5);
    expect(payload.returned_count).toBe(2);
    expect(payload.entries.length).toBe(2);
  });

  it('returns FailuresErrorEnvelope (validation_error) on unknown ?stage= value', async () => {
    const ac = new AbortController();
    const result = (await failuresResourceHandler(
      'corpus://failures?stage=not_a_real_stage',
      ac.signal,
    )) as HandlerResult;
    const payload = decodeText(result);
    const parsed = FailuresErrorEnvelopeZodSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error_code).toBe('validation_error');
      expect(parsed.data.message.length).toBeGreaterThan(0);
    }
  });

  it('returns FailuresErrorEnvelope on unknown query key (strict mode)', async () => {
    const ac = new AbortController();
    const result = (await failuresResourceHandler(
      'corpus://failures?foo=bar',
      ac.signal,
    )) as HandlerResult;
    const payload = decodeText(result);
    const parsed = FailuresErrorEnvelopeZodSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('returns FailuresErrorEnvelope on out-of-range ?limit=', async () => {
    const ac = new AbortController();
    const result = (await failuresResourceHandler(
      'corpus://failures?limit=2000',
      ac.signal,
    )) as HandlerResult;
    const payload = decodeText(result);
    const parsed = FailuresErrorEnvelopeZodSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error_code).toBe('validation_error');
    }
  });

  it('returns FailuresErrorEnvelope on non-integer ?offset=', async () => {
    const ac = new AbortController();
    const result = (await failuresResourceHandler(
      'corpus://failures?offset=not-a-number',
      ac.signal,
    )) as HandlerResult;
    const payload = decodeText(result);
    const parsed = FailuresErrorEnvelopeZodSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('returns success when query has no parameters (defaults: limit=50, offset=0)', async () => {
    await seedSidecar(
      'a.error.json',
      entry('doc-aaaaaaaa', 'classify', '2026-05-13T08:00:00Z'),
    );
    const ac = new AbortController();
    const result = (await failuresResourceHandler(
      'corpus://failures',
      ac.signal,
    )) as HandlerResult;
    const payload = decodeText(result);
    const parsed = FailuresResourceResponseZodSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.total_count).toBe(1);
    }
  });

  it('respects ?since= ISO-8601 filter', async () => {
    await seedSidecar(
      'a.error.json',
      entry('doc-aaaaaaaa', 'classify', '2026-05-10T08:00:00Z'),
    );
    await seedSidecar(
      'b.error.json',
      entry('doc-bbbbbbbb', 'embed', '2026-05-13T08:00:00Z'),
    );
    const ac = new AbortController();
    const result = (await failuresResourceHandler(
      'corpus://failures?since=2026-05-12T00%3A00%3A00Z',
      ac.signal,
    )) as HandlerResult;
    const payload = decodeText(result) as {
      total_count: number;
      entries: Array<{ doc_id: string | null }>;
    };
    expect(payload.total_count).toBe(1);
    expect(payload.entries[0]!.doc_id).toBe('doc-bbbbbbbb');
  });
});
