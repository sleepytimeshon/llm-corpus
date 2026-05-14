// SP-006 T007 — Contract test for [search].min_results + tier_total_budget_ms
// config knobs.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-013, FR-HARDEN-016
//   - specs/006-hardening/research.md Decision G, Decision J

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSearchConfig } from '../../packages/storage/src/config-loader.js';

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-search-config-'));
  // Paths.config() = ${CORPUS_HOME}/config when CORPUS_HOME is set.
  process.env.CORPUS_HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, 'config'), { recursive: true });
});

afterEach(() => {
  delete process.env.CORPUS_HOME;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function writeConfig(toml: string): void {
  const configDir = path.join(tmpHome, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.toml'), toml, 'utf8');
}

describe('PREREQ-004 — [search] config knobs', () => {
  it('returns defaults when [search] section is absent', () => {
    const cfg = loadSearchConfig();
    expect(cfg.min_results).toBe(3);
    expect(cfg.tier_total_budget_ms).toBe(600);
  });

  it('returns defaults when config.toml does not exist (ENOENT)', () => {
    // Don't write any config.
    const cfg = loadSearchConfig();
    expect(cfg.min_results).toBe(3);
    expect(cfg.tier_total_budget_ms).toBe(600);
  });

  it('parses [search].min_results when present', () => {
    writeConfig(`[search]
min_results = 5
`);
    const cfg = loadSearchConfig();
    expect(cfg.min_results).toBe(5);
  });

  it('parses [search].tier_total_budget_ms when present', () => {
    writeConfig(`[search]
tier_total_budget_ms = 1200
`);
    const cfg = loadSearchConfig();
    expect(cfg.tier_total_budget_ms).toBe(1200);
  });

  it('rejects min_results > 100', () => {
    writeConfig(`[search]
min_results = 101
`);
    expect(() => loadSearchConfig()).toThrow();
  });

  it('rejects min_results < 0', () => {
    writeConfig(`[search]
min_results = -1
`);
    expect(() => loadSearchConfig()).toThrow();
  });

  it('accepts min_results = 0 (lowest allowed)', () => {
    writeConfig(`[search]
min_results = 0
`);
    const cfg = loadSearchConfig();
    expect(cfg.min_results).toBe(0);
  });

  it('rejects tier_total_budget_ms < 50', () => {
    writeConfig(`[search]
tier_total_budget_ms = 49
`);
    expect(() => loadSearchConfig()).toThrow();
  });

  it('rejects tier_total_budget_ms > 30000', () => {
    writeConfig(`[search]
tier_total_budget_ms = 30001
`);
    expect(() => loadSearchConfig()).toThrow();
  });

  it('ignores unknown [search] keys (forward-compat)', () => {
    writeConfig(`[search]
min_results = 4
future_knob = "ignored"
`);
    const cfg = loadSearchConfig();
    expect(cfg.min_results).toBe(4);
    expect(cfg.tier_total_budget_ms).toBe(600);
  });
});
