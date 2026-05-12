// T025 (SP-003) — mime-mismatch detection.

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

describe('validateInboxFile MIME mismatch (T025)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('.md extension with %PDF magic bytes returns mime_mismatch', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'inbox-'));
    const file = path.join(dir, 'sneaky.md');
    // Write %PDF magic bytes as content despite the .md extension.
    await fsp.writeFile(file, Buffer.from('%PDF-1.4\nfake pdf body'));
    const result = await validateInboxFile(file, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data.error_code).toBe('mime_mismatch');
    }
  });

  it('error data carries extension AND detected_mime', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'inbox-'));
    const file = path.join(dir, 'sneaky.md');
    await fsp.writeFile(file, Buffer.from('%PDF-1.4\nfake'));
    const result = await validateInboxFile(file, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data['extension']).toBe('.md');
      expect(result.error.data['detected_mime']).toBe('application/pdf');
    }
  });
});
