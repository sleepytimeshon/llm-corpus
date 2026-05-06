// T059 — Integration test: native-addon allowlist rejects unknown addons.
//
// NFR-002c, US4 AS2, SC-005: a `.node` addon outside {better-sqlite3,
// sqlite-vec} MUST cause `verify-native-addons` to fail with a diagnostic
// naming the offender.
//
// Strategy: synthesize a complete fake project root under `Paths.cache()`
// (Constitution XIV — never `/tmp/`). The fake root has:
//   - package.json with a runtime dependency `bcrypt-evil-fake`
//   - node_modules/bcrypt-evil-fake/package.json + a binary.node file
// Then invoke `verifyNativeAddons(fakeRoot)` and assert violations include
// the offender. Cleanup runs in afterAll regardless of assertion outcome.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifyNativeAddons } from '../../build/verify-native-addons.js';
import { Paths } from '../../packages/contracts/src/paths.js';
import { runTool } from '../../packages/contracts/src/run-tool.js';
import { isErr } from '../../packages/contracts/src/result.js';

const FAKE_ADDON_PKG = 'bcrypt-evil-fake';
const FAKE_ADDON_BINARY = 'bindings.node';

let fakeRoot: string;
let originalCorpusHome: string | undefined;
let tmpHome: string;

describe('T059 — native-addon allowlist rejects unknown addons (NFR-002c, SC-005)', () => {
  beforeAll(() => {
    // Pin Paths.cache() to a deterministic temp dir per Constitution XIV.
    originalCorpusHome = process.env.CORPUS_HOME;
    // Use os.tmpdir() ONCE here (test scaffolding is not Constitution-XIV
    // governed code; it sets up a fresh CORPUS_HOME so the resolver produces
    // a clean Paths.cache()).
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'corpus-native-allowlist-t059-'),
    );
    process.env.CORPUS_HOME = tmpHome;

    const cacheDir = Paths.cache();
    fs.mkdirSync(cacheDir, { recursive: true });
    fakeRoot = fs.mkdtempSync(path.join(cacheDir, 'native-addon-allowlist-'));

    // Synthesize fake project root.
    const fakeRootPkg = {
      name: 'fake-root-project',
      version: '0.0.0',
      dependencies: {
        [FAKE_ADDON_PKG]: '0.0.0',
      },
    };
    fs.writeFileSync(
      path.join(fakeRoot, 'package.json'),
      JSON.stringify(fakeRootPkg, null, 2),
    );

    const fakePkgDir = path.join(fakeRoot, 'node_modules', FAKE_ADDON_PKG);
    fs.mkdirSync(fakePkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(fakePkgDir, 'package.json'),
      JSON.stringify(
        { name: FAKE_ADDON_PKG, version: '0.0.0' },
        null,
        2,
      ),
    );
    // Synthesize the .node binary — content is irrelevant; the verifier
    // only checks file extension + containing-package name.
    fs.writeFileSync(
      path.join(fakePkgDir, FAKE_ADDON_BINARY),
      Buffer.from('fake-native-addon-bytes-not-a-real-binary'),
    );
  });

  afterAll(() => {
    // Cleanup must run even if assertions failed.
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

  it('verifyNativeAddons returns ok=false with the unknown addon named in violations', () => {
    const result = verifyNativeAddons(fakeRoot);
    expect(result.ok).toBe(false);
    expect(result.scanned).toBeGreaterThan(0);
    expect(result.violations.length).toBe(1);
    const v = result.violations[0];
    expect(v.packageName).toBe(FAKE_ADDON_PKG);
    expect(v.addonPath).toContain(FAKE_ADDON_BINARY);
  });

  it('CLI entry point prints diagnostic naming the unknown addon and exits non-zero', async () => {
    // Resolve the repo root so we can locate the verifier script.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, '..', '..');
    const verifierTs = path.join(repoRoot, 'build', 'verify-native-addons.ts');
    // Constitution XII: explicit arg array, no shell interpolation.
    // Keep cwd at repoRoot so `tsx` resolves; pass --root to override the
    // scan target.
    const result = await runTool(
      'node',
      ['--import', 'tsx', verifierTs, '--root', fakeRoot],
      { cwd: repoRoot },
    );
    // Exit code must be non-zero
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.exitCode).not.toBe(0);
      // stderr must name the offender
      expect(result.error.stderr).toContain(FAKE_ADDON_PKG);
      expect(result.error.stderr).toMatch(/non-allowlisted/);
    }
  });
});
