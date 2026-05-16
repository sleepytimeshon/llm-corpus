// SP-007 T060 — Auto-start unit uninstaller (uninstall step 5).
//
// References:
//   - specs/007-install-first-run/tasks.md T060
//   - specs/007-install-first-run/spec.md FR-INSTALL-015
//   - Constitution Principles VII, X, XII
//
// Invokes the receipt's recorded `reverse_command` via `runTool()` (e.g.,
// `systemctl --user disable --now corpus.service` or `launchctl unload <plist>`),
// then unlinks the unit file. Best-effort + idempotent: ENOENT during unlink
// and non-zero reverse_command exits are tolerated.

import * as fs from 'node:fs/promises';
import {
  runTool,
  type AutoStartUnitSpec,
} from '@llm-corpus/contracts';

export async function reverseAutoStartUnit(
  unit: AutoStartUnitSpec,
  signal: AbortSignal,
): Promise<void> {
  // Best-effort: tool failure does not block uninstall.
  await runTool(unit.reverse_command.cmd, unit.reverse_command.args, { signal });
  try {
    await fs.unlink(unit.unit_path);
  } catch (cause) {
    const e = cause as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') {
      /* best-effort */
    }
  }
}
