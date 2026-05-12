// T055 (SP-003) — RED integration test: SP-003 subprocess hygiene.
//
// References:
//   - specs/003-ingest-pipeline/spec.md SC-INGEST-019
//   - Constitution XII subprocess hygiene

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

function listSp003TsFiles(): string[] {
  const scopes = [
    'packages/pipeline/src',
    'packages/extract/src',
    'packages/storage/src/unique-hash-migration.ts',
    'packages/contracts/src/with-temp-dir.ts',
    'packages/daemon/src',
  ];
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!fs.existsSync(d)) return;
    const stat = fs.statSync(d);
    if (stat.isFile()) {
      out.push(d);
      return;
    }
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (
        ent.isFile() &&
        p.endsWith('.ts') &&
        !p.endsWith('.test.ts')
      )
        out.push(p);
    }
  };
  for (const scope of scopes) walk(scope);
  return out;
}

describe('SP-003 subprocess hygiene (T055 — Phase 2 RED)', () => {
  it('ZERO references to execSync, child_process.exec, string-formed shell commands in SP-003 source', async () => {
    const offenders: { file: string; pattern: string }[] = [];
    for (const file of listSp003TsFiles()) {
      const content = fs.readFileSync(file, 'utf8');
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const pat of ['execSync', 'child_process.exec(', 'cp.exec(']) {
        if (stripped.includes(pat)) {
          offenders.push({ file, pattern: pat });
        }
      }
    }
    expect(
      offenders,
      `Subprocess hygiene violations: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});
