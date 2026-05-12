// T053 (SP-003) — RED integration test: grep over SP-003 source for process.exit.
//
// References:
//   - specs/003-ingest-pipeline/spec.md SC-INGEST-017
//   - Constitution XI Library/CLI Boundary

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && p.endsWith('.ts') && !p.endsWith('.test.ts'))
        out.push(p);
    }
  };
  walk(dir);
  return out;
}

const SP003_SCOPES = [
  'packages/pipeline/src',
  'packages/extract/src',
  'packages/storage/src',
  'packages/contracts/src',
];

describe('SP-003 no process.exit in libs (T053 — Phase 2 RED)', () => {
  it('ZERO process.exit references in SP-003 library packages', async () => {
    const offenders: string[] = [];
    for (const scope of SP003_SCOPES) {
      for (const file of listTsFiles(scope)) {
        const content = fs.readFileSync(file, 'utf8');
        // Strip comments before scanning so docstring mentions are ignored.
        const stripped = content
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/[^\n]*/g, '');
        if (/\bprocess\.exit\b/.test(stripped)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders, `process.exit found in: ${offenders.join(', ')}`).toEqual(
      [],
    );
  });
});
