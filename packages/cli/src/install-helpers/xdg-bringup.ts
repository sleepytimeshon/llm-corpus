// SP-007 T035 — XDG subtree bring-up (install-step 3).
//
// References:
//   - specs/007-install-first-run/tasks.md T022 / T035
//   - specs/007-install-first-run/spec.md FR-INSTALL-005, SC-007-006,
//     SC-007-031
//   - Constitution Principle V (Zod-validated outputs)
//   - Constitution Principle VII (cancellable IO)
//   - Constitution Principle XIV (paths from resolver only — ZERO hardcoded
//     path literals; every directory composes from `Paths.*` getters)
//
// `bringUpXdgSubtree` creates every project-relevant XDG directory under the
// resolver-derived base. Idempotent (Constitution X) — re-running on an
// existing tree is a no-op. Returns the lexicographically-sorted list of
// directories created (for inclusion in the install-receipt's
// `created_paths` array).

import * as fs from 'node:fs/promises';
import {
  Paths,
  InstallPreflightError,
  emitTelemetry,
} from '@llm-corpus/contracts';

export interface XdgBringupDeps {
  /** Optional override for tests — supplied paths list (not normally used). */
  pathOverrides?: readonly string[];
}

/**
 * The 12 directories the install creates under the XDG bases. Every entry
 * routes through `Paths.*` — no hardcoded path literal anywhere in this
 * function (Constitution XIV).
 */
function xdgPaths(): readonly string[] {
  return [
    Paths.config(),
    Paths.data(),
    Paths.state(),
    Paths.cache(),
    Paths.docs(),
    Paths.inbox(),
    Paths.pending(),
    Paths.processed(),
    Paths.failed(),
    Paths.trash(),
    Paths.docsStore(),
    Paths.pilotTelemetry(),
  ] as const;
}

export async function bringUpXdgSubtree(
  deps: XdgBringupDeps,
  signal: AbortSignal,
): Promise<string[]> {
  if (signal.aborted) {
    throw new InstallPreflightError({
      unmet_requirement: 'xdg_writable',
      message: 'aborted before xdg_bringup',
    });
  }
  const startedAt = Date.now();
  const paths = deps.pathOverrides ?? xdgPaths();
  const created: string[] = [];
  for (const p of paths) {
    if (signal.aborted) {
      throw new InstallPreflightError({
        unmet_requirement: 'xdg_writable',
        message: 'aborted mid xdg_bringup',
      });
    }
    try {
      await fs.mkdir(p, { recursive: true });
      created.push(p);
    } catch (cause) {
      const err = cause as NodeJS.ErrnoException;
      const errno = err.code ?? 'EUNKNOWN';
      try {
        await emitTelemetry({
          event: 'install.step_failed',
          timestamp: new Date().toISOString(),
          severity: 'error',
          outcome: 'failure',
          step: 'xdg_bringup',
          duration_ms: Date.now() - startedAt,
          error_code: errno,
        });
      } catch {
        /* telemetry errors must not crash install */
      }
      throw new InstallPreflightError(
        {
          unmet_requirement: 'xdg_writable',
          message: `${errno} on ${p}`,
          failed_path: p,
        },
        cause,
      );
    }
  }
  created.sort((a, b) => a.localeCompare(b));
  return created;
}
