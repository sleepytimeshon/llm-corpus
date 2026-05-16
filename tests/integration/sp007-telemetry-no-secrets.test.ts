// SP-007 T086 — Telemetry-no-secrets contract over SP-007 source.
//
// The full T086 contract drives a mixed install + uninstall + promote +
// smoke workload and asserts zero telemetry-event payloads contain the
// sudo password, the prior MCP-client config contents, or the corpus body
// content. That live mixed-workload test requires Ollama + actual install
// side-effects and is gated on `OLLAMA_RUNNING`. The static portion below
// captures the load-bearing invariant: every telemetry emission site in
// SP-007 source uses bounded, structured fields (event/severity/outcome +
// non-secret metadata), and never logs `args`, `stdin`, or whole-file
// contents.
//
// References:
//   - specs/007-install-first-run/tasks.md T086
//   - specs/007-install-first-run/spec.md FR-INSTALL-021, SC-007-026, SC-007-033
//   - Constitution Principles I, XIII

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SP007_TELEMETRY_SITES = [
  'packages/cli/src/install-command.ts',
  'packages/cli/src/uninstall-command.ts',
  'packages/cli/src/taxonomy-promote-command.ts',
  'packages/cli/src/install-helpers/auto-start-unit-installer.ts',
  'packages/cli/src/install-helpers/auto-start-unit-uninstaller.ts',
  'packages/cli/src/install-helpers/config-toml-writer.ts',
  'packages/cli/src/install-helpers/daemon-detector.ts',
  'packages/cli/src/install-helpers/firewall-provisioner.ts',
  'packages/cli/src/install-helpers/install-budget.ts',
  'packages/cli/src/install-helpers/install-receipt-reader.ts',
  'packages/cli/src/install-helpers/install-receipt-writer.ts',
  'packages/cli/src/install-helpers/install-rollback.ts',
  'packages/cli/src/install-helpers/mcp-client-config-mutator.ts',
  'packages/cli/src/install-helpers/mcp-client-config-reverser.ts',
  'packages/cli/src/install-helpers/preflight.ts',
  'packages/cli/src/install-helpers/smoke-harness.ts',
  'packages/cli/src/install-helpers/sqlite-singlefile.ts',
  'packages/cli/src/install-helpers/taxonomy-promote-helpers.ts',
  'packages/cli/src/install-helpers/taxonomy-seed-loader.ts',
  'packages/cli/src/install-helpers/verification-summary-builder.ts',
  'packages/cli/src/install-helpers/xdg-bringup.ts',
];

function readSrc(rel: string): string {
  const p = path.join(process.cwd(), rel);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('SP-007 Phase 8 T086 — telemetry payloads carry no secrets (static contract)', () => {
  it('SP-007 emitTelemetry call sites never include `args:` or `stdin:` keys (would leak sudo prompt / subprocess input)', () => {
    for (const rel of SP007_TELEMETRY_SITES) {
      const stripped = stripComments(readSrc(rel));
      // Locate every emitTelemetry({...}) block heuristically and inspect
      // the literal object that follows.
      const matches = stripped.matchAll(/emitTelemetry\(\s*\{([\s\S]*?)\}\s*\)/g);
      for (const m of matches) {
        const body = m[1];
        expect(/\bargs\s*:/.test(body), `${rel}: emitTelemetry includes args:`)
          .toBe(false);
        expect(
          /\bstdin\s*:/.test(body),
          `${rel}: emitTelemetry includes stdin:`,
        ).toBe(false);
        expect(
          /\bpassword\s*:/i.test(body),
          `${rel}: emitTelemetry includes password:`,
        ).toBe(false);
      }
    }
  });

  it('SP-007 emit sites never embed whole-file body content into telemetry', () => {
    for (const rel of SP007_TELEMETRY_SITES) {
      const stripped = stripComments(readSrc(rel));
      // readFile result must NEVER be passed directly into emitTelemetry.
      // We catch the specific anti-pattern: `body: <something>` immediately
      // after a `readFile` call paired with the same variable.
      // (This is a heuristic — actual whole-file leakage would require a
      // taint-tracking pass; the bigger contract is that SP-007 source uses
      // bounded fields per data-model.md Entity 7.)
      const dangerousPattern = /emitTelemetry\([^)]*body\s*:\s*raw/;
      expect(dangerousPattern.test(stripped), `${rel}: telemetry leaks raw body`)
        .toBe(false);
    }
  });

  it('SP-007 source never logs the resolved MCP-client config path with prior contents', () => {
    for (const rel of SP007_TELEMETRY_SITES) {
      const stripped = stripComments(readSrc(rel));
      // emitTelemetry({ prior_mcp_servers: ..., ... }) — never allowed.
      const leak = /emitTelemetry\([^)]*prior_mcp_servers\s*:/;
      expect(leak.test(stripped), `${rel}: telemetry leaks prior mcpServers contents`)
        .toBe(false);
    }
  });
});
