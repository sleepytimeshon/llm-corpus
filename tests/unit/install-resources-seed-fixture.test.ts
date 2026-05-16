// SP-007 T006 — RED-phase contract test for the curated taxonomy seed file.
//
// References:
//   - specs/007-install-first-run/tasks.md T006 / T016
//   - specs/007-install-first-run/data-model.md Entity 2
//   - specs/007-install-first-run/spec.md FR-INSTALL-008, SC-007-009
//   - specs/007-install-first-run/contracts/adr-curated-seed.md
//   - Decision D (no --seed-file override for v1)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

const SEED_PATH = path.join(
  process.cwd(),
  'packages',
  'cli',
  'src',
  'install-resources',
  'taxonomy-seed.json',
);

describe('SP-007 PREREQ-005 — curated taxonomy-seed.json (T006 / T016)', () => {
  it('seed file exists at packages/cli/src/install-resources/taxonomy-seed.json', () => {
    expect(fs.existsSync(SEED_PATH)).toBe(true);
  });

  it('seed file parses as JSON', () => {
    const raw = fs.readFileSync(SEED_PATH, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('seed file validates against TaxonomySeedZodSchema (>=25, <=50)', async () => {
    const { TaxonomySeedZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    expect(TaxonomySeedZodSchema.safeParse(seed).success).toBe(true);
    expect(Array.isArray(seed)).toBe(true);
    expect(seed.length).toBeGreaterThanOrEqual(25);
    expect(seed.length).toBeLessThanOrEqual(50);
  });

  it('seed file covers the SP-006 USER-GUIDE.md axis floor (≥5 domain, ≥6 type, ≥9 tag, ≥5 source_type)', () => {
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) as Array<{
      axis: string;
      term: string;
    }>;
    const byAxis: Record<string, number> = {
      domain: 0,
      type: 0,
      tag: 0,
      source_type: 0,
    };
    for (const e of seed) {
      byAxis[e.axis] = (byAxis[e.axis] ?? 0) + 1;
    }
    expect(byAxis.domain).toBeGreaterThanOrEqual(5);
    expect(byAxis.type).toBeGreaterThanOrEqual(6);
    expect(byAxis.tag).toBeGreaterThanOrEqual(9);
    expect(byAxis.source_type).toBeGreaterThanOrEqual(5);
  });

  it('seed file has no duplicate (axis, term) pairs', () => {
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) as Array<{
      axis: string;
      term: string;
    }>;
    const keys = seed.map((e) => `${e.axis}::${e.term}`);
    expect(new Set(keys).size).toBe(seed.length);
  });

  it('every term is non-empty + trimmed (no leading / trailing whitespace)', () => {
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) as Array<{
      axis: string;
      term: string;
    }>;
    for (const e of seed) {
      expect(e.term.length).toBeGreaterThan(0);
      expect(e.term).toBe(e.term.trim());
    }
  });
});
