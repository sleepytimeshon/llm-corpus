// T060 — Integration test: native-addon allowlist passes with only
// allowlisted addons.
//
// NFR-002c, US4 AS1: with only `better-sqlite3` + `sqlite-vec` in the
// runtime closure, `verify-native-addons` MUST exit 0 with no violations.
//
// Strategy 1: synthesize a fake root containing only allowlisted addons.
// Strategy 2: run the verifier against the REAL repo root (which currently
// only has the v1 allowlist + dev-only addons that the runtime-closure
// filter excludes). Both must pass.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifyNativeAddons } from '../../build/verify-native-addons.js';
import { Paths } from '../../packages/contracts/src/paths.js';

let fakeRoot: string;
let originalCorpusHome: string | undefined;
let tmpHome: string;

describe('T060 — native-addon allowlist passes with only allowlisted addons', () => {
  beforeAll(() => {
    originalCorpusHome = process.env.CORPUS_HOME;
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'corpus-native-allowlist-t060-'),
    );
    process.env.CORPUS_HOME = tmpHome;

    const cacheDir = Paths.cache();
    fs.mkdirSync(cacheDir, { recursive: true });
    fakeRoot = fs.mkdtempSync(path.join(cacheDir, 'native-addon-passes-'));

    // Synthesize fake root with the v1 allowlist as runtime deps.
    const fakeRootPkg = {
      name: 'fake-root-allowlist-passes',
      version: '0.0.0',
      dependencies: {
        'better-sqlite3': '0.0.0',
        'sqlite-vec': '0.0.0',
      },
    };
    fs.writeFileSync(
      path.join(fakeRoot, 'package.json'),
      JSON.stringify(fakeRootPkg, null, 2),
    );

    // better-sqlite3 fixture — runtime-closure-included, allowlisted.
    const bs3Dir = path.join(fakeRoot, 'node_modules', 'better-sqlite3');
    fs.mkdirSync(bs3Dir, { recursive: true });
    fs.writeFileSync(
      path.join(bs3Dir, 'package.json'),
      JSON.stringify({ name: 'better-sqlite3', version: '0.0.0' }, null, 2),
    );
    fs.writeFileSync(
      path.join(bs3Dir, 'better_sqlite3.node'),
      Buffer.from('better-sqlite3-fake-binary'),
    );

    // sqlite-vec fixture — also allowlisted; family-prefix match.
    const vecDir = path.join(fakeRoot, 'node_modules', 'sqlite-vec');
    fs.mkdirSync(vecDir, { recursive: true });
    fs.writeFileSync(
      path.join(vecDir, 'package.json'),
      JSON.stringify({ name: 'sqlite-vec', version: '0.0.0' }, null, 2),
    );
    fs.writeFileSync(
      path.join(vecDir, 'sqlite-vec.node'),
      Buffer.from('sqlite-vec-fake-binary'),
    );
  });

  afterAll(() => {
    try {
      if (tmpHome && fs.existsSync(tmpHome)) {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }
    } finally {
      if (originalCorpusHome === undefined) {
        delete process.env.CORPUS_HOME;
      } else {
        process.env.CORPUS_HOME = originalCorpusHome;
      }
    }
  });

  it('verifyNativeAddons returns ok=true on a fake root with only allowlisted addons', () => {
    const result = verifyNativeAddons(fakeRoot);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    // We synthesized 2 .node files (better_sqlite3 + sqlite-vec).
    expect(result.scanned).toBeGreaterThanOrEqual(2);
  });

  it('verifyNativeAddons returns ok=true on the real repo root', () => {
    // The real repo only ships the v1 allowlist as runtime deps. Dev-only
    // packages may bring in .node files but the runtime-closure filter
    // excludes them.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, '..', '..');
    const result = verifyNativeAddons(repoRoot);
    expect(
      result.ok,
      `unexpected violations: ${JSON.stringify(result.violations, null, 2)}`,
    ).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
