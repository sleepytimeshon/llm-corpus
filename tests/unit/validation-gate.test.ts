// T024 (SP-003) — contract test for validateInboxFile.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-002
//   - specs/003-ingest-pipeline/contracts/validation-gate.feature
//   - SC-INGEST-007/008/009

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { validateInboxFile } from '../../packages/pipeline/src/validation-gate.js';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('validateInboxFile (T024)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('exports validateInboxFile', () => {
    expect(typeof validateInboxFile).toBe('function');
  });

  it('rejects an extension not in the allowlist', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'inbox-'));
    const file = path.join(dir, 'thing.docx');
    await fsp.writeFile(file, 'hello');
    const result = await validateInboxFile(file, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data.error_code).toBe('mime_not_allowlisted');
    }
  });

  it('accepts a valid markdown file', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'inbox-'));
    const file = path.join(dir, 'doc.md');
    await fsp.writeFile(file, '# Hello\n\nMarkdown body.\n');
    const result = await validateInboxFile(file, new AbortController().signal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mimeType).toBe('text/markdown');
    }
  });

  it('error_code matches the gate that fired first (extension before MIME)', async () => {
    // .docx — extension fails BEFORE MIME-sniff even runs.
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'inbox-'));
    const file = path.join(dir, 'thing.docx');
    await fsp.writeFile(file, Buffer.from('%PDF-1.4'));
    const result = await validateInboxFile(file, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data.error_code).toBe('mime_not_allowlisted');
    }
  });
});
