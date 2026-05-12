// T049 (SP-003) — mixed-workload telemetry coverage.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  drain,
  batchPolicy,
} from '../../packages/pipeline/src/index.js';
import { Paths, TelemetryEvent, TELEMETRY_MAX_BYTES } from '@llm-corpus/contracts';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('telemetry coverage (T049)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('mixed workload → ≥6 distinct telemetry classes; all valid + ≤4096B', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });

    // 2 valid + 1 disallowed + 1 mismatched + 1 duplicate (to trigger dedup).
    await fsp.writeFile(path.join(inboxPath, 'a.md'), '# a\n');
    await fsp.writeFile(path.join(inboxPath, 'b.txt'), 'b body\n');
    await fsp.writeFile(path.join(inboxPath, 'bad.docx'), 'fake');
    await fsp.writeFile(path.join(inboxPath, 'sneaky.md'), Buffer.from('%PDF-1.4\nbody'));

    await drain({}, batchPolicy, new AbortController().signal);

    // Second round: drop a duplicate.
    await fsp.writeFile(path.join(inboxPath, 'a-copy.md'), '# a\n');
    await drain({}, batchPolicy, new AbortController().signal);

    const lines = fs.readFileSync(Paths.telemetry(), 'utf8').split('\n').filter(Boolean);
    const classes = new Set<string>();
    for (const line of lines) {
      const parsed = JSON.parse(line);
      classes.add(parsed.event);
      // Schema validation.
      const result = TelemetryEvent.safeParse(parsed);
      expect(result.success).toBe(true);
      // Size bound.
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(TELEMETRY_MAX_BYTES);
    }
    expect(classes.size).toBeGreaterThanOrEqual(6);
  }, 60_000);

  it('every event ≤ 4096 bytes (Constitution IX)', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });
    await fsp.writeFile(path.join(inboxPath, 'one.md'), '# x\n');
    await drain({}, batchPolicy, new AbortController().signal);
    const lines = fs.readFileSync(Paths.telemetry(), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(TELEMETRY_MAX_BYTES);
    }
  }, 30_000);
});
