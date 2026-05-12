// T054 (SP-003) — RED integration test: SP-003 source uses XDG paths only.
//
// References:
//   - specs/003-ingest-pipeline/spec.md SC-INGEST-018
//   - Constitution XIV XDG paths via single resolver

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

describe('SP-003 XDG paths only (T054 — Phase 2 RED)', () => {
  it('ZERO references to /tmp/, os.tmpdir(), /var/, or system root literals in SP-003 source', async () => {
    const offenders: { file: string; pattern: string }[] = [];
    for (const file of listSp003TsFiles()) {
      const content = fs.readFileSync(file, 'utf8');
      // Strip line/block comments before scanning
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const pat of ['os.tmpdir()', "'/tmp/", '"/tmp/', "'/var/", '"/var/']) {
        if (stripped.includes(pat)) {
          offenders.push({ file, pattern: pat });
        }
      }
    }
    expect(
      offenders,
      `XDG violations found: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});
