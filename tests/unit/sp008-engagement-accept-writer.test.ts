// SP-008 T023 — RED unit test for the acceptance-event writer.
//
// Verifies the writer's contract per ADR-016 + FR-ENGAGEMENT-002:
//   (i) finds matching engagement.corpus_find_invoked event by request_id
//  (ii) rejects unknown request_id (AcceptUnknownRequestIdError)
// (iii) rejects zero-result query (AcceptZeroResultQueryError)
//  (iv) idempotent on duplicate (AcceptDuplicateRequestIdError —
//       INFORMATIONAL)
//   (v) appends well-formed engagement.acceptance_event via emitTelemetry()
//  (vi) accepts AbortSignal and aborts mid-scan
//
// References:
//   - specs/008-user-acceptance/tasks.md T023 / T026
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-002, SC-008-007..010
//   - Constitution Principles V, VII, X, XIII

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  Paths,
  AcceptUnknownRequestIdError,
  AcceptZeroResultQueryError,
  AcceptDuplicateRequestIdError,
} from '@llm-corpus/contracts';
import { runAcceptanceEventWriter } from '../../packages/cli/src/engagement/acceptance-event-writer.js';

const validUuid1 = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee';
const validUuid2 = '11111111-2222-4333-9444-555555555555';

async function seedTelemetry(lines: readonly string[]): Promise<void> {
  const target = Paths.telemetry();
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, lines.join('\n') + (lines.length > 0 ? '\n' : ''));
}

describe('SP-008 T023 — acceptance-event writer', () => {
  let tempHome: string;
  let prev: string | undefined;
  beforeEach(async () => {
    tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp008-writer-'));
    prev = process.env.CORPUS_HOME;
    process.env.CORPUS_HOME = tempHome;
  });
  afterEach(async () => {
    if (prev === undefined) delete process.env.CORPUS_HOME;
    else process.env.CORPUS_HOME = prev;
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  it('finds the matching find event and emits acceptance event', async () => {
    await seedTelemetry([
      JSON.stringify({
        event: 'engagement.corpus_find_invoked',
        timestamp: '2026-05-10T10:00:00Z',
        request_id: validUuid1,
        query: 'q1',
        query_hash: 'a'.repeat(64),
        result_count: 3,
        tier_used: 'hybrid',
        duration_ms: 10,
      }),
    ]);
    await runAcceptanceEventWriter(
      { request_id: validUuid1, note: 'useful' },
      new AbortController().signal,
    );
    const raw = await fsp.readFile(Paths.telemetry(), 'utf8');
    const accepts = raw
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as { event: string; request_id?: string; acceptance_note?: string })
      .filter((e) => e.event === 'engagement.acceptance_event');
    expect(accepts.length).toBe(1);
    expect(accepts[0]!.request_id).toBe(validUuid1);
    expect(accepts[0]!.acceptance_note).toBe('useful');
  });

  it('throws AcceptUnknownRequestIdError when no matching find event exists', async () => {
    await seedTelemetry([
      JSON.stringify({
        event: 'engagement.corpus_find_invoked',
        timestamp: '2026-05-10T10:00:00Z',
        request_id: validUuid1,
        query: 'q1',
        query_hash: 'a'.repeat(64),
        result_count: 3,
        tier_used: 'hybrid',
        duration_ms: 10,
      }),
    ]);
    await expect(
      runAcceptanceEventWriter(
        { request_id: validUuid2 },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(AcceptUnknownRequestIdError);
  });

  it('throws AcceptZeroResultQueryError when matching find event has result_count===0', async () => {
    await seedTelemetry([
      JSON.stringify({
        event: 'engagement.corpus_find_invoked',
        timestamp: '2026-05-10T10:00:00Z',
        request_id: validUuid1,
        query: 'q1',
        query_hash: 'a'.repeat(64),
        result_count: 0,
        tier_used: 'fs-grep',
        duration_ms: 10,
      }),
    ]);
    await expect(
      runAcceptanceEventWriter(
        { request_id: validUuid1 },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(AcceptZeroResultQueryError);
  });

  it('throws AcceptDuplicateRequestIdError when a prior acceptance event exists for the same request_id', async () => {
    await seedTelemetry([
      JSON.stringify({
        event: 'engagement.corpus_find_invoked',
        timestamp: '2026-05-10T10:00:00Z',
        request_id: validUuid1,
        query: 'q1',
        query_hash: 'a'.repeat(64),
        result_count: 3,
        tier_used: 'hybrid',
        duration_ms: 10,
      }),
      JSON.stringify({
        event: 'engagement.acceptance_event',
        timestamp: '2026-05-10T11:00:00Z',
        request_id: validUuid1,
      }),
    ]);
    const before = (await fsp.readFile(Paths.telemetry(), 'utf8')).split('\n').filter((l) => l.length > 0).length;
    await expect(
      runAcceptanceEventWriter(
        { request_id: validUuid1 },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(AcceptDuplicateRequestIdError);
    const after = (await fsp.readFile(Paths.telemetry(), 'utf8')).split('\n').filter((l) => l.length > 0).length;
    // ZERO new event appended on duplicate path (Constitution X idempotent).
    expect(after).toBe(before);
  });

  it('aborts mid-scan on SIGINT (AbortSignal already aborted)', async () => {
    await seedTelemetry([
      JSON.stringify({
        event: 'engagement.corpus_find_invoked',
        timestamp: '2026-05-10T10:00:00Z',
        request_id: validUuid1,
        query: 'q1',
        query_hash: 'a'.repeat(64),
        result_count: 3,
        tier_used: 'hybrid',
        duration_ms: 10,
      }),
    ]);
    const ctrl = new AbortController();
    ctrl.abort('test-abort');
    await expect(
      runAcceptanceEventWriter({ request_id: validUuid1 }, ctrl.signal),
    ).rejects.toBeDefined();
  });
});
