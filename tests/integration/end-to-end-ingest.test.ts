// T045 (SP-003) — end-to-end ingest of 3 MIME families (PDF excluded for speed; covered separately).

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

describe('end-to-end ingest (T045)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('drops 3 files (MD, TXT, HTML); yields 3 documents rows + body files + processed/ + telemetry classes', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });
    await fsp.writeFile(path.join(inboxPath, 'doc.md'), '# md\n\nbody\n');
    await fsp.writeFile(path.join(inboxPath, 'doc.txt'), 'plain text body\n');
    await fsp.writeFile(path.join(inboxPath, 'doc.html'), '<h1>html</h1><p>body</p>');

    const r = await drain({}, batchPolicy, new AbortController().signal);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ingested).toBe(3);
    }

    // 3 documents rows.
    const db = openIndexReadWrite();
    const count = (db
      .prepare(`SELECT COUNT(*) AS c FROM documents WHERE status = 'success'`)
      .get() as { c: number }).c;
    db.close();
    expect(count).toBe(3);

    // 3 body files in docsStore (recursive walk).
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      if (!fs.existsSync(dir)) return out;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...walk(p));
        else out.push(p);
      }
      return out;
    };
    expect(walk(Paths.docsStore()).length).toBe(3);

    // pending/ empty; processed/ has 3.
    expect(fs.readdirSync(Paths.pending()).length).toBe(0);
    expect(fs.readdirSync(Paths.processed()).length).toBe(3);

    // ≥4 distinct telemetry event classes (inbox.allowlist_hit, ingest.dedup_miss, ingest.normalized, ingest.completed).
    const lines = fs.readFileSync(Paths.telemetry(), 'utf8').split('\n').filter(Boolean);
    const classes = new Set<string>();
    for (const line of lines) {
      try {
        classes.add(JSON.parse(line).event);
      } catch {
        /* ignore */
      }
    }
    expect(classes.size).toBeGreaterThanOrEqual(4);
  }, 60_000);
});
