// SP-000-Lite Phase 2 (T014) — personal-scale qualifier presence contract.
//
// Asserts that the qualifier from data-model.md Entity 1 is present inline in:
//   - The summary JSON's `personal_scale_qualifier` field.
//   - `corpus pilot --help` output.
//   - packages/cli/src/pilot/README.md.
//
// Also asserts the absence of industry-generalization phrases anywhere those
// artifacts surface (Constitution XVI).
//
// TDD: Phase 1 deliberately omits the qualifier from --help and README so this
// test stays red until Phase 3 (T026) lands.
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T014
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-008, SC-004
//   - specs/000-nfr-008-pilot-lite/contracts/telemetry.feature
//   - Constitution Principle XVI

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

const INDUSTRY_GENERALIZATION_PHRASES = [
  'industry-standard',
  'benchmark floor',
  'cross-model',
  'cross-user',
  'cross-machine',
];

async function loadHarness(): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import('@llm-corpus/pipeline')) as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function loadCliPilot(): Promise<Record<string, unknown> | undefined> {
  // CLI package has no exports map; import the compiled artifact directly
  // via a relative path. Phase 1 builds this file; Phase 3 (T026) seeds the
  // qualifier inside `pilotHelpText`.
  const target = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'pilot', 'command.js');
  try {
    return (await import(target)) as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function assertNoIndustryPhrases(text: string, label: string): void {
  for (const phrase of INDUSTRY_GENERALIZATION_PHRASES) {
    expect(text.toLowerCase().includes(phrase), `${label} contains forbidden phrase "${phrase}"`).toBe(
      false,
    );
  }
}

describe('SP-000-Lite T014 — personal-scale qualifier presence (FR-PILOT-008, Constitution XVI)', () => {
  it('mkPilotSummary seeds personal_scale_qualifier with the data-model.md Entity 1 string', async () => {
    const mod = await loadHarness();
    const mk = mod?.mkPilotSummary as
      | ((events: unknown[], meta: unknown) => Record<string, unknown>)
      | undefined;
    expect(mk, 'mkPilotSummary not yet exported (Phase 3 T023)').toBeDefined();
    if (!mk) return;
    const summary = mk([], { run_id: '019099d4-78f0-7e61-a37c-8c2a9b5d2e10', iteration: 1, variant: 'v1' });
    const q = summary.personal_scale_qualifier;
    expect(typeof q).toBe('string');
    expect(q).not.toBe('');
    expect((q as string).includes('qwen3:8b')).toBe(true);
    const hasPersonalOrShon = (q as string).includes('personal') || (q as string).includes('Shon');
    expect(hasPersonalOrShon).toBe(true);
    assertNoIndustryPhrases(q as string, 'summary.personal_scale_qualifier');
  });

  it('corpus pilot --help text carries qwen3:8b AND (personal | Shon) inline', async () => {
    const mod = await loadCliPilot();
    expect(mod, 'pilot/command.js not built — run npm run build').toBeDefined();
    const helpFn = mod?.pilotHelpText as (() => string) | undefined;
    expect(helpFn).toBeDefined();
    if (!helpFn) return;
    const help = helpFn();
    expect(help.includes('qwen3:8b'), 'help text missing "qwen3:8b"').toBe(true);
    const hasPersonalOrShon = help.includes('personal') || help.includes('Shon');
    expect(hasPersonalOrShon, 'help text missing "personal" or "Shon"').toBe(true);
    assertNoIndustryPhrases(help, 'pilot --help text');
  });

  it('packages/cli/src/pilot/README.md carries qwen3:8b AND (personal | Shon) inline', () => {
    const readmePath = path.join(REPO_ROOT, 'packages', 'cli', 'src', 'pilot', 'README.md');
    expect(fs.existsSync(readmePath), 'README.md missing').toBe(true);
    const src = fs.readFileSync(readmePath, 'utf8');
    expect(src.includes('qwen3:8b'), 'README missing "qwen3:8b"').toBe(true);
    const hasPersonalOrShon = src.includes('personal') || src.includes('Shon');
    expect(hasPersonalOrShon, 'README missing "personal" or "Shon"').toBe(true);
    // README must not assert industry generalization in its primary qualifier
    // line. We allow the phrase strings to appear ONLY inside negation
    // sentences ("NOT an industry-standard floor"). Phase 3 (T026) seeds the
    // exact data-model.md Entity 1 string, which contains "NOT
    // industry-standard"; tighten this assertion in Phase 3 to require the
    // verbatim line and bypass the simple substring check.
    //
    // Phase 2 assertion: the qualifier line must be present.
    expect(
      src.toLowerCase().includes('not an industry-standard floor'),
      'README missing the data-model.md Entity 1 qualifier line',
    ).toBe(true);
  });
});
