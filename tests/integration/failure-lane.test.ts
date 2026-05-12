// T047 (SP-003) — failure-lane sidecar contract.

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
import { openIndexReadWrite } from '@llm-corpus/storage';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('failure-lane sidecar (T047)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('rejected files end up in failed/ with valid .error.json sidecar; no success row', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });

    // Disallowed extension.
    await fsp.writeFile(path.join(inboxPath, 'bad.docx'), 'fake');
    // MIME mismatch.
    await fsp.writeFile(path.join(inboxPath, 'sneaky.md'), Buffer.from('%PDF-1.4\nbody'));

    const r = await drain({}, batchPolicy, new AbortController().signal);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.failed).toBe(2);
    }

    // No documents row.
    const db = openIndexReadWrite();
    const count = (db
      .prepare(`SELECT COUNT(*) AS c FROM documents WHERE status = 'success'`)
      .get() as { c: number }).c;
    db.close();
    expect(count).toBe(0);

    // failed/ has the files + sidecars.
    const failedDir = Paths.failed();
    const entries = fs.readdirSync(failedDir);
    // 2 files + 2 sidecars = 4.
    expect(entries.length).toBe(4);
    expect(entries.filter((e) => e.endsWith('.error.json')).length).toBe(2);

    // Sidecar is valid JSON with required keys.
    const sidecars = entries.filter((e) => e.endsWith('.error.json'));
    for (const sc of sidecars) {
      const content = JSON.parse(fs.readFileSync(path.join(failedDir, sc), 'utf8'));
      expect(content.error_code).toBeDefined();
      expect(content.message).toBeDefined();
      expect(content.stage).toBeDefined();
      expect(content.timestamp).toBeDefined();
      expect(typeof content.retriable).toBe('boolean');
    }
  }, 30_000);
});
