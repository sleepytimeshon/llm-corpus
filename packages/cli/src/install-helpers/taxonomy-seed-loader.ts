// SP-007 T038 — Curated taxonomy-seed loader (install-step 6).
//
// References:
//   - specs/007-install-first-run/tasks.md T025 / T038
//   - specs/007-install-first-run/spec.md FR-INSTALL-008, SC-007-009
//   - specs/007-install-first-run/contracts/adr-curated-seed.md (ADR-015)
//   - specs/007-install-first-run/research.md Decision D
//   - Constitution Principles V, VIII, IX, X
//
// Loads `packages/cli/src/install-resources/taxonomy-seed.json`; Zod-validates
// via `TaxonomySeedZodSchema`; acquires `Paths.drainLock()` via flock; opens
// `BEGIN IMMEDIATE`; executes `INSERT OR IGNORE INTO taxonomy_terms ...` per
// entry; COMMITs; releases lock. Returns the counts. Idempotent on re-run
// (existing rows preserved per Constitution X).

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  TaxonomySeedZodSchema,
  emitTelemetry,
  TaxonomyPromoteLockContentionError,
  type TaxonomySeed,
  type TaxonomySeedEntry,
} from '@llm-corpus/contracts';
import { acquireDrainLock } from '@llm-corpus/pipeline';

export interface TaxonomySeedLoaderDeps {
  /** Optional override for tests — supplied seed array. */
  seedOverride?: TaxonomySeed;
  /** Optional override for tests — alternate seed file location. */
  seedPathOverride?: string;
}

export interface TaxonomySeedLoadResult {
  insertedCount: number;
  skippedCount: number;
  seededEntries: readonly TaxonomySeedEntry[];
  establishedAt: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the curated-seed JSON path. The CLI package layout is
 *   packages/cli/src/install-helpers/taxonomy-seed-loader.ts (this file)
 *   packages/cli/src/install-resources/taxonomy-seed.json    (sibling dir)
 *
 * The post-build dist mirror preserves the relative layout — both
 * `dist/install-helpers/...` and `dist/install-resources/...` resolve via the
 * same `..` traversal. Bundled via the `files` field in
 * `packages/cli/package.json`.
 */
function defaultSeedPath(): string {
  return path.join(HERE, '..', 'install-resources', 'taxonomy-seed.json');
}

export async function loadAndInsertTaxonomySeed(
  db: DatabaseType,
  deps: TaxonomySeedLoaderDeps,
  signal: AbortSignal,
): Promise<TaxonomySeedLoadResult> {
  const startedAt = Date.now();
  let seed: TaxonomySeed;
  if (deps.seedOverride) {
    seed = deps.seedOverride;
  } else {
    const seedPath = deps.seedPathOverride ?? defaultSeedPath();
    const body = await fs.readFile(seedPath, 'utf8');
    const parsed = JSON.parse(body) as unknown;
    const validated = TaxonomySeedZodSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(
        `taxonomy-seed.json failed Zod validation: ${validated.error.message}`,
      );
    }
    seed = validated.data;
  }

  // Acquire drain-lock (Constitution IX — serialized writers).
  const lockRes = acquireDrainLock({ signal });
  if (!lockRes.ok) {
    try {
      await emitTelemetry({
        event: 'pipeline.lock_contention',
        timestamp: new Date().toISOString(),
        severity: 'warn',
        outcome: 'failed',
        lock_path: lockRes.error.data.lock_path,
        requesting_pid: process.pid,
      });
    } catch {
      /* telemetry must not crash install */
    }
    throw new TaxonomyPromoteLockContentionError({
      lock_path: lockRes.error.data.lock_path,
      lock_holder_hint: lockRes.error.data.message,
    });
  }
  const lock = lockRes.value;

  const establishedAt = new Date().toISOString();
  let insertedCount = 0;
  try {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO taxonomy_terms (axis, term, state, established_at)
       VALUES (?, ?, 'established', ?)`,
    );
    const txn = db.transaction((entries: readonly TaxonomySeedEntry[]) => {
      let inserted = 0;
      for (const e of entries) {
        const info = insert.run(e.axis, e.term, establishedAt);
        if (info.changes > 0) inserted += 1;
      }
      return inserted;
    });
    insertedCount = txn.immediate(seed);
  } catch (cause) {
    try {
      await emitTelemetry({
        event: 'install.step_failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failure',
        step: 'taxonomy_seed',
        duration_ms: Date.now() - startedAt,
        error_code: ((cause as Error).message ?? 'unknown').slice(0, 64),
      });
    } catch {
      /* telemetry must not crash install */
    }
    throw cause;
  } finally {
    lock.release();
  }

  return {
    insertedCount,
    skippedCount: seed.length - insertedCount,
    seededEntries: seed,
    establishedAt,
  };
}
