// T044 (SP-003) — drain orchestrator + policies.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  drain,
  interactivePolicy,
  batchPolicy,
} from '../../packages/pipeline/src/index.js';
import { Paths } from '@llm-corpus/contracts';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('drain orchestrator + policies (T044)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('exports drain function', () => {
    expect(typeof drain).toBe('function');
  });

  it('exports interactivePolicy and batchPolicy', () => {
    expect(interactivePolicy.name).toBe('interactive');
    expect(batchPolicy.name).toBe('batch');
    expect(interactivePolicy.retryOnRetriableError).toBe(false);
    expect(batchPolicy.retryOnRetriableError).toBe(true);
  });

  it('drain processes a single dropped Markdown file under interactivePolicy', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });
    await fsp.writeFile(path.join(inboxPath, 'doc.md'), '# hello\n');

    const r = await drain({}, interactivePolicy, new AbortController().signal);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ingested).toBe(1);
    }
  }, 30_000);

  it('drain processes a single dropped Markdown file under batchPolicy too (one pipeline, two policies)', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });
    await fsp.writeFile(path.join(inboxPath, 'doc.md'), '# hello batch\n');

    const r = await drain({}, batchPolicy, new AbortController().signal);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ingested).toBe(1);
    }
  }, 30_000);
});
