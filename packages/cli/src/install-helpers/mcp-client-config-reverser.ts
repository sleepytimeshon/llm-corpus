// SP-007 T060 — MCP-client config reverser (uninstall step 3).
//
// References:
//   - specs/007-install-first-run/tasks.md T060
//   - specs/007-install-first-run/spec.md FR-INSTALL-015, FR-INSTALL-016
//   - specs/007-install-first-run/contracts/adr-install-uninstall-surface.md (ADR-012)
//   - Constitution Principles V (Zod boundary), VIII (atomic), X (idempotent)
//
// Reads the recorded MCP-client config file, deletes `mcpServers.corpus`,
// preserves every other entry + every other top-level key, writes back
// atomically via `withTempDir`. Idempotent: no `corpus` key, missing file,
// or malformed JSON all collapse to a no-op (uninstall must be tolerant of
// hand-edits after install).

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MCPClientConfigFileZodSchema, withTempDir } from '@llm-corpus/contracts';

export interface ReverseMcpClientConfigArgs {
  /** Absolute path to the MCP-client config file recorded in the install-receipt. */
  path: string;
}

export async function reverseMcpClientConfig(
  args: ReverseMcpClientConfigArgs,
  signal: AbortSignal,
): Promise<void> {
  let body: string;
  try {
    body = await fs.readFile(args.path, 'utf8');
  } catch (cause) {
    const e = cause as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return; // already gone — no-op
    return; // best-effort; uninstall continues
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return; // malformed JSON — operator edited the file; no-op
  }

  // Zod-validate permissively (mcpServers optional, passthrough at root).
  const v = MCPClientConfigFileZodSchema.safeParse(parsed);
  if (!v.success) return; // schema-invalid; best-effort no-op

  const obj = v.data;
  if (obj.mcpServers === undefined || !('corpus' in obj.mcpServers)) {
    return; // nothing to remove
  }

  // Delete the corpus key; preserve everything else.
  const { corpus: _omitted, ...rest } = obj.mcpServers;
  void _omitted;
  const mutated = {
    ...obj,
    mcpServers: rest,
  };

  await fs.mkdir(path.dirname(args.path), { recursive: true });
  await withTempDir(
    async (dir) => {
      const tmp = path.join(dir, 'config.json');
      await fs.writeFile(tmp, JSON.stringify(mutated, null, 2) + '\n', 'utf8');
      await fs.rename(tmp, args.path);
    },
    { signal, namespace: 'sp007-uninstall-mcp' },
  );
}
