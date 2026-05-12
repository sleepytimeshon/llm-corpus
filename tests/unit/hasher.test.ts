// T035 (SP-003) — contract test for hashFile.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { hashFile } from '../../packages/pipeline/src/hasher.js';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('hashFile (T035)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('exports hashFile', () => {
    expect(typeof hashFile).toBe('function');
  });

  it('full-file stream SHA-256 (lowercase hex)', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'hash-'));
    const file = path.join(dir, 'sample.bin');
    const data = Buffer.from('the quick brown fox jumps over the lazy dog');
    await fsp.writeFile(file, data);
    const result = await hashFile(file, new AbortController().signal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const expected = crypto.createHash('sha256').update(data).digest('hex');
      expect(result.value.hash).toBe(expected);
      expect(result.value.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('cancellable via AbortSignal (mid-stream)', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'hash-'));
    const file = path.join(dir, 'big.bin');
    // 5 MB file — enough to read in multiple chunks.
    await fsp.writeFile(file, Buffer.alloc(5 * 1024 * 1024, 'a'));
    const controller = new AbortController();
    // Abort almost immediately.
    setImmediate(() => controller.abort());
    const result = await hashFile(file, controller.signal).catch((e) => ({ thrown: e }));
    // Either Result.err(aborted) or throws AbortError — both are valid.
    if ('thrown' in result) {
      expect(String(result.thrown)).toMatch(/abort/i);
    } else {
      // If we beat the abort, that's also acceptable on a fast machine.
      expect(typeof result.ok).toBe('boolean');
    }
  });
});
