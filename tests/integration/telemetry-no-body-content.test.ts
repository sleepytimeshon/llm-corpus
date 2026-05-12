// T051 (SP-003) — no body content in telemetry.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  drain,
  batchPolicy,
} from '../../packages/pipeline/src/index.js';
import { Paths } from '@llm-corpus/contracts';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('telemetry no body content (T051)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('fixture canary phrase does NOT appear anywhere in telemetry', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });
    const canary = 'FIXTURE_CANARY_PHRASE_xyz123';
    await fsp.writeFile(
      path.join(inboxPath, 'doc.md'),
      `# title\n\nbody contains ${canary} as content.\n`,
    );

    await drain({}, batchPolicy, new AbortController().signal);

    const tel = fs.readFileSync(Paths.telemetry(), 'utf8');
    expect(tel).not.toContain(canary);
  }, 30_000);
});
