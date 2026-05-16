// SP-007 T041 — Install-receipt reader (uninstall preflight).
//
// References:
//   - specs/007-install-first-run/tasks.md T027 / T041
//   - specs/007-install-first-run/spec.md FR-INSTALL-012, SC-007-012
//   - Constitution Principle V

import * as fs from 'node:fs/promises';
import {
  InstallReceiptZodSchema,
  InstallReceiptUninstalledZodSchema,
  UninstallReceiptMissingError,
  type InstallReceipt,
  type InstallReceiptUninstalled,
} from '@llm-corpus/contracts';
import { installReceiptPath } from './install-receipt-writer.js';

export async function readInstallReceipt(
  signal: AbortSignal,
): Promise<InstallReceipt | InstallReceiptUninstalled> {
  void signal;
  const receiptPath = installReceiptPath();
  let body: string;
  try {
    body = await fs.readFile(receiptPath, 'utf8');
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    throw new UninstallReceiptMissingError(
      {
        receipt_path: receiptPath,
        message:
          err.code === 'ENOENT'
            ? 'install-receipt not found'
            : `read failed: ${err.message ?? err.code ?? 'unknown'}`,
      },
      cause,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new UninstallReceiptMissingError(
      { receipt_path: receiptPath, message: 'install-receipt malformed JSON' },
      cause,
    );
  }
  const installRes = InstallReceiptZodSchema.safeParse(parsed);
  if (installRes.success) return installRes.data;
  const uninstalledRes = InstallReceiptUninstalledZodSchema.safeParse(parsed);
  if (uninstalledRes.success) return uninstalledRes.data;
  throw new UninstallReceiptMissingError({
    receipt_path: receiptPath,
    message: `install-receipt failed Zod validation: ${installRes.error.message.slice(0, 256)}`,
  });
}
