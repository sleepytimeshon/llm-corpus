#!/usr/bin/env node
// T020 — Build-time native-addon allowlist verification.
//
// Constitution VII (Cancellable, Bounded IO) + XII (Subprocess Hygiene):
// native addons making raw POSIX socket calls bypass the JS-land egress hook.
// The allowlist is the architectural defense for that bypass vector.
//
// Walks the runtime dependency closure (transitive deps of root
// `dependencies`, EXCLUDING `devDependencies`), maps each `.node` file to
// its containing package, and exits non-zero if any runtime-shipped package
// outside the v1 allowlist contributes a `.node` file.
//
// Why runtime-only? NFR-002c targets addons that would make raw POSIX
// socket calls in the *running* MCP server — the artifact the user
// executes. Dev-time tooling (vitest, rollup, esbuild platform packages)
// brings in `.node` files for the test/build toolchain only; they never
// load in the corpus runtime, so they cannot bypass the egress hook.
// The architectural defense is on the runtime closure.
//
// v1 allowlist: better-sqlite3, sqlite-vec.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWLIST: ReadonlySet<string> = new Set(['better-sqlite3', 'sqlite-vec']);

interface Violation {
  packageName: string;
  addonPath: string;
}

/** Walk a directory tree and yield every `.node` file. */
function* walkNodeAddons(root: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkNodeAddons(full);
    } else if (entry.isFile() && entry.name.endsWith('.node')) {
      yield full;
    }
  }
}

/**
 * Compute the runtime dependency closure of the root package.json
 * (transitive deps of `dependencies`, NOT `devDependencies`). Returns the
 * set of package names that contribute to the runtime artifact.
 */
function computeRuntimeClosure(root: string): Set<string> {
  const rootPkgPath = path.join(root, 'package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    workspaces?: string[];
  };
  const seen = new Set<string>();
  const queue: string[] = [];
  // Seed: root runtime deps + every workspace package's runtime deps.
  if (rootPkg.dependencies) {
    queue.push(...Object.keys(rootPkg.dependencies));
  }
  for (const wsGlob of rootPkg.workspaces ?? []) {
    // Workspaces in this project are exact paths, not globs.
    const wsPkgJson = path.join(root, wsGlob, 'package.json');
    if (!fs.existsSync(wsPkgJson)) continue;
    try {
      const wsPkg = JSON.parse(fs.readFileSync(wsPkgJson, 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      if (wsPkg.dependencies) queue.push(...Object.keys(wsPkg.dependencies));
    } catch {
      // ignore malformed
    }
  }
  // BFS through the closure.
  const nodeModules = path.join(root, 'node_modules');
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || seen.has(name)) continue;
    // Skip workspace packages — they're handled by their own deps lists.
    if (name.startsWith('@llm-corpus/')) {
      seen.add(name);
      continue;
    }
    seen.add(name);
    const depPkgJson = path.join(nodeModules, name, 'package.json');
    if (!fs.existsSync(depPkgJson)) continue;
    try {
      const depPkg = JSON.parse(fs.readFileSync(depPkgJson, 'utf8')) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      if (depPkg.dependencies) queue.push(...Object.keys(depPkg.dependencies));
      if (depPkg.optionalDependencies) queue.push(...Object.keys(depPkg.optionalDependencies));
    } catch {
      // ignore malformed
    }
  }
  return seen;
}

/**
 * Map an addon path back to its containing npm package name by walking up
 * looking for the nearest `package.json`. Returns the `name` field.
 */
function findContainingPackage(addonPath: string, root: string): string | null {
  let dir = path.dirname(addonPath);
  // Walk upward until we exit `root` or hit a package.json
  while (dir.startsWith(root) && dir !== root) {
    const pkgJson = path.join(dir, 'package.json');
    if (fs.existsSync(pkgJson)) {
      try {
        const raw = fs.readFileSync(pkgJson, 'utf8');
        const parsed = JSON.parse(raw) as { name?: string };
        if (typeof parsed.name === 'string' && parsed.name.length > 0) {
          return parsed.name;
        }
      } catch {
        // ignore malformed package.json — keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Strip `@scope/` prefix when comparing against the allowlist. */
function isAllowlisted(packageName: string): boolean {
  if (ALLOWLIST.has(packageName)) return true;
  // sqlite-vec ships platform-specific subpackages like `sqlite-vec-linux-x64`
  // — accept the family by prefix match.
  for (const allow of ALLOWLIST) {
    if (packageName === allow) return true;
    if (packageName.startsWith(`${allow}-`)) return true;
    if (packageName.startsWith(`@${allow}/`)) return true;
  }
  return false;
}

function repoRoot(): string {
  // Resolve from this file's location: build/verify-native-addons.ts → repo root.
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), '..');
}

export function verifyNativeAddons(rootArg?: string): {
  ok: boolean;
  violations: Violation[];
  scanned: number;
} {
  const root = rootArg ?? repoRoot();
  const nodeModules = path.join(root, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    // No deps installed yet — first install hasn't run. Trivially passes.
    return { ok: true, violations: [], scanned: 0 };
  }
  const runtimeClosure = computeRuntimeClosure(root);
  const violations: Violation[] = [];
  let scanned = 0;
  for (const addon of walkNodeAddons(nodeModules)) {
    scanned += 1;
    const pkg = findContainingPackage(addon, nodeModules) ?? '<unknown>';
    // Skip dev-only packages — they never load in the corpus runtime.
    if (!runtimeClosure.has(pkg)) continue;
    if (!isAllowlisted(pkg)) {
      violations.push({ packageName: pkg, addonPath: addon });
    }
  }
  return { ok: violations.length === 0, violations, scanned };
}

// CLI entry point: only run when invoked directly (not when imported by tests).
function isMain(): boolean {
  if (typeof process === 'undefined' || !process.argv[1]) return false;
  const invoked = path.resolve(process.argv[1]);
  const here = fileURLToPath(import.meta.url);
  return invoked === here;
}

/** Parse --root <path> from process.argv (after the script path). */
function parseRootArg(): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && i + 1 < argv.length) {
      return argv[i + 1];
    }
    const v = argv[i];
    if (v && v.startsWith('--root=')) {
      return v.slice('--root='.length);
    }
  }
  return undefined;
}

if (isMain()) {
  const result = verifyNativeAddons(parseRootArg());
  if (!result.ok) {
    process.stderr.write(
      `[verify-native-addons] FAIL: ${result.violations.length} non-allowlisted .node addon(s) found ` +
        `(scanned ${result.scanned} total).\n`,
    );
    for (const v of result.violations) {
      process.stderr.write(`  - package=${v.packageName} addon=${v.addonPath}\n`);
    }
    process.stderr.write(
      `Allowlist: ${[...ALLOWLIST].join(', ')}. ` +
        `Add a new addon ONLY via explicit ALLOWLIST edit + Constitution review (Principle I).\n`,
    );
    // Build/CLI boundary: process.exit is allowed here (this is build/, not packages/).
    process.exit(1);
  } else {
    process.stdout.write(
      `[verify-native-addons] OK (scanned ${result.scanned} .node file(s); all in allowlist).\n`,
    );
  }
}
