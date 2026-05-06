// T055 — Lint-fixture test: scope boundary (transport/daemon are NOT in scope).
//
// NFR-001 scope per data-model.md §ForbiddenImportSet:
//   IN scope:  packages/{pipeline,storage,index,inference,extract,cli}
//   OUT of scope: packages/{transport,daemon,contracts}
//
// The transport + daemon packages HOST the egress hook — they need access
// to undici/dns/http2/tls to monkey-patch them. Lint must not flag forbidden
// imports there.
//
// Strategy: load the PROJECT eslint.config.js (the real one) and lint a
// fixture file as if it lived under packages/transport/. The project config's
// `files` glob determines whether the rule applies. We use ESLint's
// `overrideConfigFile` set to false so the real config is used.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ESLint } from 'eslint';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

// Place the fixture under packages/transport/ (out-of-scope for NFR-001 lint).
// File name uses a unique prefix so it cannot accidentally collide with real
// transport sources, and so cleanup is reliable.
const fixtureUnderTransport = path.join(
  repoRoot,
  'packages',
  'transport',
  'src',
  '__nfr001-scope-boundary-fixture.ts',
);

const FIXTURE_BODY = `// Fixture for T055 — scope-boundary verification.
// This file lives under packages/transport/ which is OUT of NFR-001 lint
// scope. The forbidden import below MUST NOT trigger the rule.
import 'node:http';
export {};
`;

describe('T055 — NFR-001 lint scope excludes transport/daemon', () => {
  beforeAll(() => {
    fs.writeFileSync(fixtureUnderTransport, FIXTURE_BODY);
  });
  afterAll(() => {
    if (fs.existsSync(fixtureUnderTransport)) {
      fs.rmSync(fixtureUnderTransport);
    }
  });

  it('forbidden import in packages/transport/ is NOT reported by NFR-001 rule', async () => {
    // Use the real project eslint.config.js — that's the contract under test.
    const linter = new ESLint({ cwd: repoRoot });
    const results = await linter.lintFiles([fixtureUnderTransport]);
    expect(results.length).toBe(1);
    const r = results[0];
    const nfr001 = r.messages.filter(
      (m) => m.ruleId === 'llm-corpus/no-forbidden-network-imports',
    );
    expect(nfr001).toEqual([]);
  });
});
