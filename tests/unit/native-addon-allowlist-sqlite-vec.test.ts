// SP-005 T009 — Contract test for sqlite-vec native-addon allowlist.
//
// References:
//   - specs/005-retrieval/plan.md PREREQ-005, Decision B, Risk R1
//   - Constitution Principle XII

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

describe('PREREQ-005 — sqlite-vec native-addon allowlist', () => {
  it('build/verify-native-addons.ts allowlist contains sqlite-vec', () => {
    const verifyPath = path.join(
      process.cwd(),
      'build',
      'verify-native-addons.ts',
    );
    const text = fs.readFileSync(verifyPath, 'utf8');
    expect(text).toMatch(/sqlite-vec/);
  });

  it('namespace load works on a fresh better-sqlite3 connection', () => {
    const db = new Database(':memory:');
    try {
      sqliteVec.load(db);
      // vec_distance_cosine should now be registered. Pass valid 3-dim
      // float32 vectors (12 zero bytes is interpreted as 3 zero floats,
      // which vec_distance_cosine returns NULL on — instead use literal
      // JSON-array form which is sqlite-vec's documented binding).
      const row = db
        .prepare(`SELECT vec_distance_cosine('[1,2,3]', '[1,2,3]') AS d`)
        .get() as { d: number };
      expect(typeof row.d).toBe('number');
      expect(row.d).toBeCloseTo(0, 5);
    } finally {
      db.close();
    }
  });
});
