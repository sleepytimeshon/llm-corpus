// SP-006 T030 — Unit test for the corpus://failures storage adapter.
//
// RED-phase coverage (Engineer #3 / Phase 4):
//   - Globs Paths.failed() + '/*.error.json' AND '/*.recovery.error.json'
//   - Parses each sidecar per FailureEntryZodSchema
//   - Enriches each entry with absolute `sidecar_path`
//   - Applies optional `stage` + `since` filters
//   - Sorts descending by `timestamp`
//   - Paginates by `limit` / `offset`
//   - Per-sidecar graceful skip on malformed JSON (emits
//     `failures.sidecar_parse_failed` telemetry, skips file, continues)
//   - On missing Paths.failed() returns `{entries:[], total_count:0,
//     returned_count:0, schema_version:1}` (ENOENT graceful empty)
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-009, FR-HARDEN-011, FR-HARDEN-012
//   - specs/006-hardening/contracts/adr-failures-resource.md
//   - specs/006-hardening/data-model.md §"Entity 2"
//   - Constitution Principles III (Substrate, Not Surface), V, VII, XIII

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Paths, FailuresResourceResponseZodSchema } from '@llm-corpus/contracts';
import { readFailuresEntries } from '../../packages/storage/src/failures-resource-adapter.js';

interface FixtureSidecar {
  filename: string;
  json: unknown;
}

async function seedFailedDir(sidecars: FixtureSidecar[]): Promise<string> {
  const failedDir = Paths.failed();
  await fsp.mkdir(failedDir, { recursive: true });
  for (const s of sidecars) {
    const p = path.join(failedDir, s.filename);
    if (typeof s.json === 'string') {
      await fsp.writeFile(p, s.json, 'utf8');
    } else {
      await fsp.writeFile(p, JSON.stringify(s.json, null, 2), 'utf8');
    }
  }
  return failedDir;
}

function entryFor(
  doc: string,
  stage: string,
  ts: string,
  extra: Partial<{ error_code: string; message: string; retriable: boolean }> = {},
): unknown {
  return {
    doc_id: doc,
    stage,
    error_code: extra.error_code ?? 'persist_failed',
    message: extra.message ?? `synthetic ${stage}`,
    timestamp: ts,
    retriable: extra.retriable ?? false,
  };
}

describe('T030 — readFailuresEntries (US2 P1)', () => {
  let tmpHome: string;
  let originalCorpusHome: string | undefined;
  let originalState: string | undefined;
  let originalTelemetryFile: string;

  beforeEach(async () => {
    originalCorpusHome = process.env.CORPUS_HOME;
    originalState = process.env.XDG_STATE_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-failures-adapter-'));
    process.env.CORPUS_HOME = tmpHome;
    // Ensure telemetry writes land somewhere isolated.
    originalTelemetryFile = Paths.telemetry();
    await fsp.mkdir(path.dirname(originalTelemetryFile), { recursive: true });
  });

  afterEach(() => {
    if (originalCorpusHome === undefined) {
      delete process.env.CORPUS_HOME;
    } else {
      process.env.CORPUS_HOME = originalCorpusHome;
    }
    if (originalState === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalState;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns graceful empty response when Paths.failed() does not exist', async () => {
    // Do not create the failed dir.
    const ac = new AbortController();
    const result = await readFailuresEntries(
      { limit: 50, offset: 0 },
      ac.signal,
    );
    expect(FailuresResourceResponseZodSchema.safeParse(result).success).toBe(
      true,
    );
    expect(result).toEqual({
      entries: [],
      total_count: 0,
      returned_count: 0,
      schema_version: 1,
    });
  });

  it('globs *.error.json AND *.recovery.error.json and parses both', async () => {
    await seedFailedDir([
      {
        filename: 'doc-aaaaaaaa.error.json',
        json: entryFor('doc-aaaaaaaa', 'classify', '2026-05-13T08:00:00Z', {
          error_code: 'schema_invalid',
          retriable: true,
        }),
      },
      {
        filename: 'doc-bbbbbbbb.recovery.error.json',
        json: entryFor(
          'doc-bbbbbbbb',
          'unrecoverable_orphan',
          '2026-05-13T08:01:00Z',
          { error_code: 'unrecoverable_orphan', retriable: false },
        ),
      },
    ]);
    const ac = new AbortController();
    const result = await readFailuresEntries(
      { limit: 50, offset: 0 },
      ac.signal,
    );
    expect(result.total_count).toBe(2);
    expect(result.returned_count).toBe(2);
    expect(result.entries.length).toBe(2);
    const stages = result.entries.map((e) => e.stage).sort();
    expect(stages).toEqual(['classify', 'unrecoverable_orphan']);
    // Each entry must carry sidecar_path under Paths.failed().
    for (const e of result.entries) {
      expect(e.sidecar_path.startsWith(Paths.failed())).toBe(true);
    }
  });

  it('sorts entries strictly descending by timestamp', async () => {
    await seedFailedDir([
      {
        filename: 'a.error.json',
        json: entryFor('doc-aaaaaaaa', 'classify', '2026-05-10T00:00:00Z'),
      },
      {
        filename: 'b.error.json',
        json: entryFor('doc-bbbbbbbb', 'embed', '2026-05-13T00:00:00Z'),
      },
      {
        filename: 'c.error.json',
        json: entryFor('doc-cccccccc', 'index', '2026-05-12T00:00:00Z'),
      },
    ]);
    const ac = new AbortController();
    const result = await readFailuresEntries(
      { limit: 50, offset: 0 },
      ac.signal,
    );
    expect(result.entries.map((e) => e.doc_id)).toEqual([
      'doc-bbbbbbbb',
      'doc-cccccccc',
      'doc-aaaaaaaa',
    ]);
  });

  it('applies stage filter (closed enum)', async () => {
    await seedFailedDir([
      {
        filename: 'a.error.json',
        json: entryFor('doc-aaaaaaaa', 'classify', '2026-05-10T00:00:00Z'),
      },
      {
        filename: 'b.error.json',
        json: entryFor('doc-bbbbbbbb', 'embed', '2026-05-13T00:00:00Z'),
      },
      {
        filename: 'c.error.json',
        json: entryFor('doc-cccccccc', 'classify', '2026-05-12T00:00:00Z'),
      },
    ]);
    const ac = new AbortController();
    const result = await readFailuresEntries(
      { stage: 'classify', limit: 50, offset: 0 },
      ac.signal,
    );
    expect(result.total_count).toBe(2);
    expect(result.entries.every((e) => e.stage === 'classify')).toBe(true);
  });

  it('applies since filter (ISO-8601 inclusive lower bound)', async () => {
    await seedFailedDir([
      {
        filename: 'a.error.json',
        json: entryFor('doc-aaaaaaaa', 'classify', '2026-05-10T00:00:00Z'),
      },
      {
        filename: 'b.error.json',
        json: entryFor('doc-bbbbbbbb', 'embed', '2026-05-13T00:00:00Z'),
      },
      {
        filename: 'c.error.json',
        json: entryFor('doc-cccccccc', 'index', '2026-05-12T00:00:00Z'),
      },
    ]);
    const ac = new AbortController();
    const result = await readFailuresEntries(
      { since: '2026-05-12T00:00:00Z', limit: 50, offset: 0 },
      ac.signal,
    );
    expect(result.total_count).toBe(2);
    expect(result.entries.map((e) => e.doc_id).sort()).toEqual([
      'doc-bbbbbbbb',
      'doc-cccccccc',
    ]);
  });

  it('paginates by limit + offset', async () => {
    const sidecars: FixtureSidecar[] = [];
    for (let i = 0; i < 20; i++) {
      const doc = `doc-${i.toString(16).padStart(8, '0')}`;
      const ts = `2026-05-13T08:${i.toString().padStart(2, '0')}:00Z`;
      sidecars.push({
        filename: `${doc}.error.json`,
        json: entryFor(doc, 'classify', ts),
      });
    }
    await seedFailedDir(sidecars);
    const ac = new AbortController();
    const page = await readFailuresEntries(
      { limit: 5, offset: 10 },
      ac.signal,
    );
    expect(page.total_count).toBe(20);
    expect(page.returned_count).toBe(5);
    expect(page.entries.length).toBe(5);
    // Descending by timestamp: timestamps 00..19, descending → 19,18,17,...
    // offset 10 → starts at the 11th entry (index 10) = timestamp 09:00.
    expect(page.entries[0]!.timestamp).toBe('2026-05-13T08:09:00Z');
    expect(page.entries[4]!.timestamp).toBe('2026-05-13T08:05:00Z');
  });

  it('default limit (50) and offset (0) return all when ≤ 50', async () => {
    await seedFailedDir([
      {
        filename: 'a.error.json',
        json: entryFor('doc-aaaaaaaa', 'classify', '2026-05-10T00:00:00Z'),
      },
      {
        filename: 'b.error.json',
        json: entryFor('doc-bbbbbbbb', 'embed', '2026-05-13T00:00:00Z'),
      },
    ]);
    const ac = new AbortController();
    const result = await readFailuresEntries(
      { limit: 50, offset: 0 },
      ac.signal,
    );
    expect(result.total_count).toBe(2);
    expect(result.returned_count).toBe(2);
  });

  it('gracefully skips a malformed sidecar and emits failures.sidecar_parse_failed', async () => {
    await seedFailedDir([
      {
        filename: 'good-a.error.json',
        json: entryFor('doc-aaaaaaaa', 'classify', '2026-05-13T08:00:00Z'),
      },
      {
        filename: 'malformed.error.json',
        json: '{ not valid json,,,',
      },
      {
        filename: 'good-b.error.json',
        json: entryFor('doc-bbbbbbbb', 'embed', '2026-05-13T08:01:00Z'),
      },
    ]);
    const ac = new AbortController();
    const result = await readFailuresEntries(
      { limit: 50, offset: 0 },
      ac.signal,
    );
    expect(result.total_count).toBe(2);
    expect(result.returned_count).toBe(2);
    const docIds = result.entries.map((e) => e.doc_id).sort();
    expect(docIds).toEqual(['doc-aaaaaaaa', 'doc-bbbbbbbb']);

    // Verify telemetry event emitted for the malformed sidecar.
    const telemetryFile = Paths.telemetry();
    expect(fs.existsSync(telemetryFile)).toBe(true);
    const lines = fs
      .readFileSync(telemetryFile, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0);
    const parseFailedEvents = lines
      .map((l) => JSON.parse(l) as { event?: string; sidecar_path?: string })
      .filter((e) => e.event === 'failures.sidecar_parse_failed');
    expect(parseFailedEvents.length).toBeGreaterThanOrEqual(1);
    expect(
      parseFailedEvents.some(
        (e) =>
          typeof e.sidecar_path === 'string' &&
          e.sidecar_path.endsWith('malformed.error.json'),
      ),
    ).toBe(true);
  });

  it('gracefully skips a schema-invalid sidecar (well-formed JSON, bad shape)', async () => {
    await seedFailedDir([
      {
        filename: 'good.error.json',
        json: entryFor('doc-aaaaaaaa', 'classify', '2026-05-13T08:00:00Z'),
      },
      {
        filename: 'bad-stage.error.json',
        json: {
          doc_id: 'doc-deadbeef',
          stage: 'not-a-real-stage',
          error_code: 'persist_failed',
          message: 'oops',
          timestamp: '2026-05-13T08:01:00Z',
          retriable: false,
        },
      },
    ]);
    const ac = new AbortController();
    const result = await readFailuresEntries(
      { limit: 50, offset: 0 },
      ac.signal,
    );
    expect(result.total_count).toBe(1);
    expect(result.entries[0]!.doc_id).toBe('doc-aaaaaaaa');
  });

  it('produces a Zod-validated FailuresResourceResponse envelope', async () => {
    await seedFailedDir([
      {
        filename: 'a.error.json',
        json: entryFor('doc-aaaaaaaa', 'classify', '2026-05-13T08:00:00Z'),
      },
    ]);
    const ac = new AbortController();
    const result = await readFailuresEntries(
      { limit: 50, offset: 0 },
      ac.signal,
    );
    const parsed = FailuresResourceResponseZodSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.schema_version).toBe(1);
    }
  });

  it('ignores files that do not match the *.error.json or *.recovery.error.json patterns', async () => {
    await seedFailedDir([
      {
        filename: 'good.error.json',
        json: entryFor('doc-aaaaaaaa', 'classify', '2026-05-13T08:00:00Z'),
      },
      {
        filename: 'unrelated.txt',
        json: 'plain text',
      },
      {
        filename: 'doc-abc12345.md',
        json: '# body file',
      },
    ]);
    const ac = new AbortController();
    const result = await readFailuresEntries(
      { limit: 50, offset: 0 },
      ac.signal,
    );
    expect(result.total_count).toBe(1);
    expect(result.entries[0]!.doc_id).toBe('doc-aaaaaaaa');
  });

  it('respects a pre-aborted AbortSignal', async () => {
    await seedFailedDir([
      {
        filename: 'a.error.json',
        json: entryFor('doc-aaaaaaaa', 'classify', '2026-05-13T08:00:00Z'),
      },
    ]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      readFailuresEntries({ limit: 50, offset: 0 }, ac.signal),
    ).rejects.toThrow();
  });
});
