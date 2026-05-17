// SP-008 T029 — RED unit test for the idempotent duplicate-accept path per
// FR-ENGAGEMENT-002 + Constitution X.
//
// The acceptance-event writer must:
//   - throw AcceptDuplicateRequestIdError (INFORMATIONAL) carrying the prior
//     acceptance timestamp
//   - NOT append a new engagement.acceptance_event line
//
// The CLI entry point separately translates the informational error to
// stdout "already accepted: <id> at <ts>" + exit 0 (covered by integration
// tests under packages/cli/test/ when the binary runs).
//
// References:
//   - specs/008-user-acceptance/tasks.md T029
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-002, SC-008-010
//   - Constitution Principle X (idempotent transitions)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths, AcceptDuplicateRequestIdError } from '@llm-corpus/contracts';
import { runAcceptanceEventWriter } from '../../packages/cli/src/engagement/acceptance-event-writer.js';

const validUuid = 'feedface-feed-4dad-9bee-cafebabecafe';

describe('SP-008 T029 — corpus accept idempotency on duplicate request_id', () => {
  let tempHome: string;
  let prev: string | undefined;
  beforeEach(async () => {
    tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp008-idem-'));
    prev = process.env.CORPUS_HOME;
    process.env.CORPUS_HOME = tempHome;
  });
  afterEach(async () => {
    if (prev === undefined) delete process.env.CORPUS_HOME;
    else process.env.CORPUS_HOME = prev;
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  it('returns AcceptDuplicateRequestIdError with prior_acceptance_timestamp and writes NO new event', async () => {
    const target = Paths.telemetry();
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const findEvent = JSON.stringify({
      event: 'engagement.corpus_find_invoked',
      timestamp: '2026-05-10T10:00:00Z',
      request_id: validUuid,
      query: 'q',
      query_hash: 'a'.repeat(64),
      result_count: 2,
      tier_used: 'hybrid',
      duration_ms: 5,
    });
    const priorAccept = JSON.stringify({
      event: 'engagement.acceptance_event',
      timestamp: '2026-05-10T11:30:00Z',
      request_id: validUuid,
    });
    await fsp.writeFile(target, findEvent + '\n' + priorAccept + '\n');

    const lineCountBefore = (await fsp.readFile(target, 'utf8'))
      .split('\n')
      .filter((l) => l.length > 0).length;

    let caught: unknown;
    try {
      await runAcceptanceEventWriter(
        { request_id: validUuid, note: 'try again' },
        new AbortController().signal,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AcceptDuplicateRequestIdError);
    const dup = caught as AcceptDuplicateRequestIdError;
    expect(dup.data.prior_acceptance_timestamp).toBe('2026-05-10T11:30:00Z');
    expect(dup.data.request_id).toBe(validUuid);

    const lineCountAfter = (await fsp.readFile(target, 'utf8'))
      .split('\n')
      .filter((l) => l.length > 0).length;
    expect(lineCountAfter).toBe(lineCountBefore);
  });
});
