// T046 (SP-003) — content-hash dedup + F-10 adversary.

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

describe('dedup content-hash (T046)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('drop file twice under different filenames → single documents row + ingest.dedup_hit', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });

    // First drop.
    await fsp.writeFile(path.join(inboxPath, 'a.md'), '# same body\n');
    const r1 = await drain({}, batchPolicy, new AbortController().signal);
    expect(r1.ok).toBe(true);

    // Second drop with same content under different name.
    await fsp.writeFile(path.join(inboxPath, 'b.md'), '# same body\n');
    const r2 = await drain({}, batchPolicy, new AbortController().signal);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.value.deduplicated).toBe(1);
    }

    // Single row.
    const db = openIndexReadWrite();
    const count = (db
      .prepare(`SELECT COUNT(*) AS c FROM documents WHERE status = 'success'`)
      .get() as { c: number }).c;
    db.close();
    expect(count).toBe(1);

    // dedup_hit telemetry present.
    const tel = fs.readFileSync(Paths.telemetry(), 'utf8');
    expect(tel).toContain('ingest.dedup_hit');

    // pending/ is empty.
    expect(fs.readdirSync(Paths.pending()).length).toBe(0);
  }, 30_000);

  it('F-10 adversary: two slightly-different large files produce TWO rows', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });

    const prefix = 'a'.repeat(1024 * 1024); // 1 MB identical prefix.
    await fsp.writeFile(path.join(inboxPath, 'adversary-A.txt'), prefix + '0');
    await fsp.writeFile(path.join(inboxPath, 'adversary-B.txt'), prefix + '1');

    const r = await drain({}, batchPolicy, new AbortController().signal);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ingested).toBe(2);
    }

    const db = openIndexReadWrite();
    const count = (db
      .prepare(`SELECT COUNT(*) AS c FROM documents WHERE status = 'success'`)
      .get() as { c: number }).c;
    db.close();
    expect(count).toBe(2);
  }, 60_000);
});
