// T026 (SP-003) — size-boundary at max and max+1.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { validateInboxFile } from '../../packages/pipeline/src/validation-gate.js';

function freshCorpusHome(maxFileSizeMb: number = 1): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  // Write a config.toml with a small ingest cap so we can test the boundary
  // without writing a 100MB file.
  const configDir = path.join(root, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.toml'),
    `[ingest]\nmax_file_size_mb = ${maxFileSizeMb}\n`,
  );
  return root;
}

describe('validateInboxFile size boundary (T026)', () => {
  beforeEach(() => {
    freshCorpusHome(1); // 1 MB cap for the test.
  });

  it('file at exactly max_file_size_mb passes', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'inbox-'));
    const file = path.join(dir, 'big.txt');
    const oneMB = 1024 * 1024;
    await fsp.writeFile(file, Buffer.alloc(oneMB, 'a'));
    const result = await validateInboxFile(file, new AbortController().signal);
    expect(result.ok).toBe(true);
  });

  it('file at max+1 bytes fails with size_exceeded', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'inbox-'));
    const file = path.join(dir, 'too-big.txt');
    const oneMB = 1024 * 1024;
    await fsp.writeFile(file, Buffer.alloc(oneMB + 1, 'a'));
    const result = await validateInboxFile(file, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data.error_code).toBe('size_exceeded');
    }
  });
});
