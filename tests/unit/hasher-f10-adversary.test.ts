// T036 (SP-003) — ADR-002 F-10 adversary verified at the module level.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { hashFile } from '../../packages/pipeline/src/hasher.js';

const FIXTURE_A =
  'tests/fixtures/sp003-ingest/adversary-60mb-identical-prefix-A.bin';
const FIXTURE_B =
  'tests/fixtures/sp003-ingest/adversary-60mb-identical-prefix-B.bin';

const fixturesAvailable = fs.existsSync(FIXTURE_A) && fs.existsSync(FIXTURE_B);

describe.skipIf(!fixturesAvailable)(
  'hashFile F-10 adversary (T036, 60MB fixtures)',
  () => {
    it('two 60-MB files with identical prefix produce DIFFERENT hashes', async () => {
      const a = await hashFile(FIXTURE_A, new AbortController().signal);
      const b = await hashFile(FIXTURE_B, new AbortController().signal);
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      if (a.ok && b.ok) {
        expect(a.value.hash).not.toBe(b.value.hash);
      }
    });
  },
);

describe('hashFile F-10 adversary (T036 — synthetic small-scale)', () => {
  it('small files with identical prefix + differing last byte produce DIFFERENT hashes', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-f10-'));
    const fileA = path.join(dir, 'a.bin');
    const fileB = path.join(dir, 'b.bin');
    const prefix = Buffer.alloc(1024 * 1024, 0xab);
    await fsp.writeFile(fileA, Buffer.concat([prefix, Buffer.from([0x00])]));
    await fsp.writeFile(fileB, Buffer.concat([prefix, Buffer.from([0xff])]));
    const a = await hashFile(fileA, new AbortController().signal);
    const b = await hashFile(fileB, new AbortController().signal);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.hash).not.toBe(b.value.hash);
    }
  });

  it('hasher module exports hashFile (sanity)', () => {
    expect(typeof hashFile).toBe('function');
  });
});
