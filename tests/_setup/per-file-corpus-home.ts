// Per-test-file CORPUS_HOME isolation.
//
// Vitest runs test files in parallel pool workers. Several tests in the
// repo write to `Paths.pilotTelemetry()/pilot-iter*.jsonl` and to
// `Paths.telemetry()`; without per-worker state isolation, parallel writers
// race on the same files (e.g., the SP-000-Lite contract tests under
// `tests/contract/sp000-lite/` collide on `pilot-iter1.jsonl`).
//
// This setup file runs ONCE per test file (vitest contract). It assigns the
// worker a unique `CORPUS_HOME` rooted in `os.tmpdir()` so every Paths.*
// invocation in that file resolves under a private subtree. Tests that
// explicitly override `CORPUS_HOME` in `beforeEach`/`beforeAll` (e.g.,
// `tests/unit/paths.test.ts`, `packages/contracts/src/paths.test.ts`) keep
// working — their setup runs AFTER this file's top-level code and overrides
// the value.
//
// Safety:
//   - `tests/unit/paths.test.ts` deletes CORPUS_HOME in beforeEach (assertions
//     against default $HOME paths re-establish the desired state).
//   - `packages/contracts/src/paths.test.ts` does the same.
//   - `tests/contract/sp000-lite/path-resolution.test.ts` line 56 guards
//     `expect(p.startsWith(home))` behind `if (!xdgState && !corpusHome)`
//     so the assertion is properly defensive.
//
// Constitution: this is test plumbing, not production code; Principle XIV
// path discipline applies to packages/, not tests/_setup/.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Skip if any caller (CI, parent runner) has already pinned CORPUS_HOME.
//
// We root the isolated tree under $HOME — NOT under os.tmpdir() — because the
// SP-000-Lite path-discipline contract test
// (tests/contract/sp000-lite/path-resolution.test.ts:50–52) asserts that
// `Paths.pilotTelemetry()` does NOT start with `/tmp/`, `/var/`, or
// `os.tmpdir() + path.sep`. Putting the isolated CORPUS_HOME under $HOME
// keeps that invariant intact while still isolating workers from one another.
if (process.env.CORPUS_HOME === undefined || process.env.CORPUS_HOME.length === 0) {
  const baseDir = path.join(os.homedir(), '.cache', 'llm-corpus-test');
  fs.mkdirSync(baseDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(baseDir, `worker-${process.pid}-`));
  process.env.CORPUS_HOME = tmp;
}
