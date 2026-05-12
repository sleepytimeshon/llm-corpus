// SP-003 T085 — empirical per-doc budget measurement.
//
// References:
//   - specs/003-ingest-pipeline/plan.md "Performance Goals"
//   - specs/003-ingest-pipeline/spec.md Edge Case "Per-document ingest budget"
//
// We measure the per-document wall-clock for a small set of fixtures and
// emit the timing to stdout. The result is recorded as a footnote in
// plan.md's "Performance Goals" section.

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
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-budget-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('per-doc ingest budget (T085)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('measures per-doc wall-clock for MD/TXT/HTML and asserts within plan budget', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });
    // 10x of each MIME family for a reasonable sample.
    for (let i = 0; i < 10; i++) {
      await fsp.writeFile(path.join(inboxPath, `m-${i}.md`), `# md ${i}\nbody\n`);
      await fsp.writeFile(path.join(inboxPath, `t-${i}.txt`), `text ${i}\n`);
      await fsp.writeFile(
        path.join(inboxPath, `h-${i}.html`),
        `<h1>h ${i}</h1><p>body</p>`,
      );
    }

    const start = Date.now();
    const r = await drain({}, batchPolicy, new AbortController().signal);
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ingested).toBe(30);
    }
    const perDoc = elapsed / 30;
    // Plan budget: under 500ms p95 for MD/TXT/HTML up to 5 MB.
    expect(perDoc).toBeLessThan(500);
    // Surface the measurement so an operator running the test can see it.
    process.stdout.write(`[per-doc-budget] total=${elapsed}ms n=30 mean=${perDoc.toFixed(1)}ms\n`);
  }, 60_000);
});
