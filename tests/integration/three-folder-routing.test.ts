// T048 (SP-003) — three-folder routing invariants.

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

describe('three-folder routing (T048)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('post-drain: pending/ is empty', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });
    await fsp.writeFile(path.join(inboxPath, 'a.md'), 'a\n');
    await fsp.writeFile(path.join(inboxPath, 'b.docx'), 'fake');

    await drain({}, batchPolicy, new AbortController().signal);
    expect(fs.readdirSync(Paths.pending()).length).toBe(0);
  }, 30_000);

  it('every processed/ file has a success row', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });
    await fsp.writeFile(path.join(inboxPath, 'a.md'), '# a\n');
    await fsp.writeFile(path.join(inboxPath, 'b.md'), '# b\n');

    await drain({}, batchPolicy, new AbortController().signal);
    const processed = fs.readdirSync(Paths.processed());
    expect(processed.length).toBe(2);

    const db = openIndexReadWrite();
    const count = (db
      .prepare(`SELECT COUNT(*) AS c FROM documents WHERE status = 'success'`)
      .get() as { c: number }).c;
    db.close();
    expect(count).toBe(2);
  }, 30_000);

  it('every failed/ entry has a sidecar AND no matching success row', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });
    await fsp.writeFile(path.join(inboxPath, 'bad.docx'), 'fake');

    await drain({}, batchPolicy, new AbortController().signal);

    const failed = fs.readdirSync(Paths.failed());
    const sidecars = failed.filter((f) => f.endsWith('.error.json'));
    const failedFiles = failed.filter((f) => !f.endsWith('.error.json'));
    expect(sidecars.length).toBe(failedFiles.length);
    expect(failedFiles.length).toBeGreaterThan(0);

    const db = openIndexReadWrite();
    const successCount = (db
      .prepare(`SELECT COUNT(*) AS c FROM documents WHERE status = 'success'`)
      .get() as { c: number }).c;
    db.close();
    expect(successCount).toBe(0);
  }, 30_000);
});
