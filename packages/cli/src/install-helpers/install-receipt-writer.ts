// SP-007 T040 — Install-receipt atomic writer (install-step 10).
//
// References:
//   - specs/007-install-first-run/tasks.md T027 / T040
//   - specs/007-install-first-run/spec.md FR-INSTALL-012, SC-007-012
//   - Constitution Principles V, VIII

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  Paths,
  InstallReceiptZodSchema,
  InstallReceiptUninstalledZodSchema,
  InstallReceiptWriteError,
  withTempDir,
  type InstallReceipt,
  type InstallReceiptUninstalled,
} from '@llm-corpus/contracts';

export const INSTALL_RECEIPT_FILENAME = 'install-receipt.json';

export function installReceiptPath(): string {
  return path.join(Paths.state(), INSTALL_RECEIPT_FILENAME);
}

export async function writeInstallReceipt(
  receipt: InstallReceipt | InstallReceiptUninstalled,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw new InstallReceiptWriteError({ message: 'aborted before write' });
  }
  // Validate; Uninstalled is a superset so try strict-install first then fall
  // back to uninstalled.
  const targetPath = installReceiptPath();
  const validatedAsInstall = InstallReceiptZodSchema.safeParse(receipt);
  const validatedAsUninstalled =
    InstallReceiptUninstalledZodSchema.safeParse(receipt);
  if (!validatedAsInstall.success && !validatedAsUninstalled.success) {
    throw new InstallReceiptWriteError({
      message: `receipt failed Zod validation: ${validatedAsInstall.error.message.slice(0, 256)}`,
    });
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await withTempDir(
    async (dir) => {
      const tmp = path.join(dir, INSTALL_RECEIPT_FILENAME);
      await fs.writeFile(tmp, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
      await fs.rename(tmp, targetPath);
    },
    { signal, namespace: 'sp007-install-receipt' },
  );

  // Post-write re-validate.
  const post = await fs.readFile(targetPath, 'utf8');
  const parsed = JSON.parse(post) as unknown;
  const okInstall = InstallReceiptZodSchema.safeParse(parsed).success;
  const okUninstalled =
    InstallReceiptUninstalledZodSchema.safeParse(parsed).success;
  if (!okInstall && !okUninstalled) {
    throw new InstallReceiptWriteError({
      message: 'post-write receipt failed Zod re-validation',
    });
  }
}
