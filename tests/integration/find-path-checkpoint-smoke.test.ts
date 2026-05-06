// T045 — Integration test: find-path checkpoint smoke (SC-008 partial).
// Source of truth: contracts/telemetry-egress-events.md §EgressCheckpointEvent
//
// Exercise the find-path with a 10-document smoke fixture. Each find call MUST
// emit one `egress.checkpoint` event with `pipeline_stage: 'find'`. The
// checkpoint helper MUST be exported from @llm-corpus/contracts (telemetry).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  emitCheckpoint,
} from '../../packages/contracts/src/telemetry.js';
import { emitFindCheckpoint } from '../../packages/transport/src/mcp-checkpoint.js';

describe('Find-path checkpoint smoke (T045 / SC-008 partial)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-checkpoint-smoke-'));
    process.env.CORPUS_HOME = tmpHome;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('emitCheckpoint helper is exported from @llm-corpus/contracts', () => {
    expect(typeof emitCheckpoint).toBe('function');
  });

  it('emitFindCheckpoint helper is exported from @llm-corpus/transport', () => {
    expect(typeof emitFindCheckpoint).toBe('function');
  });

  it('emits one egress.checkpoint per document for a 10-document smoke fixture', async () => {
    // Synthesize 10 doc IDs matching the doc-XXXXXXXX pattern.
    const docs = Array.from({ length: 10 }, (_, i) =>
      `doc-${i.toString(16).padStart(8, '0')}`,
    );
    for (const doc of docs) {
      await emitFindCheckpoint(doc, randomUUID());
    }

    const telPath = path.join(tmpHome, 'state', 'telemetry.jsonl');
    expect(fs.existsSync(telPath)).toBe(true);
    const lines = fs
      .readFileSync(telPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    const checkpoints = lines.filter(
      (e: { event: string }) => e.event === 'egress.checkpoint',
    );
    expect(checkpoints.length).toBe(10);

    // All find-stage checkpoints reference the synthetic doc IDs
    for (const doc of docs) {
      const ev = checkpoints.find((c: { doc_id: string }) => c.doc_id === doc);
      expect(ev).toBeDefined();
      expect(ev.pipeline_stage).toBe('find');
    }
  });
});
