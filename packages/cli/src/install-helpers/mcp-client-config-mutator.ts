// SP-007 T039 — MCP-client config mutator (install-step 7).
//
// References:
//   - specs/007-install-first-run/tasks.md T026 / T039
//   - specs/007-install-first-run/spec.md FR-INSTALL-009, SC-007-010
//   - specs/007-install-first-run/contracts/adr-install-uninstall-surface.md (ADR-012)
//   - Constitution Principles V, VIII (atomic), X (idempotent)
//
// Resolves the MCP-client config path via precedence (1) CLI arg, (2)
// `$CLAUDE_CONFIG_PATH`, (3) `~/.claude.json`. Reads + parses + Zod-
// validates; mutates `mcpServers.corpus` to `{command: <abs-path>, args:
// ['mcp']}`; writes back atomically. Preserves all other keys.
//
// Constitution XIV: the MCP-client config path is the ONLY allowed `~/...`
// reference outside `Paths.*` and is recorded explicitly in the install-
// receipt's `mcp_client_configs[]` array.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  MCPClientConfigFileZodSchema,
  withTempDir,
  InstallMCPClientConfigError,
  emitTelemetry,
  type MCPClientConfigFile,
} from '@llm-corpus/contracts';

export interface McpClientConfigMutateArgs {
  /** `--mcp-client-config <path>` override; highest precedence. */
  configPathOverride?: string;
  /** Absolute path to the installed corpus binary. */
  corpusBinaryPath: string;
}

export interface McpClientConfigMutateResult {
  path: string;
  key_added: 'mcpServers.corpus';
}

export function resolveMcpClientConfigPath(
  override: string | undefined,
): string {
  if (override !== undefined && override.length > 0) return override;
  const envVar = process.env.CLAUDE_CONFIG_PATH;
  if (envVar !== undefined && envVar.length > 0) return envVar;
  // The ONLY allowed `os.homedir()` reference per Constitution XIV
  // exception, recorded explicitly in the install-receipt.
  return path.join(os.homedir(), '.claude.json');
}

export async function mutateMcpClientConfig(
  args: McpClientConfigMutateArgs,
  signal: AbortSignal,
): Promise<McpClientConfigMutateResult> {
  if (signal.aborted) {
    throw new InstallMCPClientConfigError({
      path: '<unresolved>',
      message: 'aborted before mcp_client_config',
    });
  }
  const startedAt = Date.now();
  const target = resolveMcpClientConfigPath(args.configPathOverride);

  let existing: MCPClientConfigFile = { mcpServers: {} };
  let exists = true;
  try {
    const body = await fs.readFile(target, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (cause) {
      await emitStepFailed('mcp_client_config', startedAt, 'malformed_json');
      throw new InstallMCPClientConfigError(
        { path: target, message: 'malformed JSON' },
        cause,
      );
    }
    const validated = MCPClientConfigFileZodSchema.safeParse(parsed);
    if (!validated.success) {
      await emitStepFailed('mcp_client_config', startedAt, 'schema_invalid');
      throw new InstallMCPClientConfigError({
        path: target,
        message: `schema-invalid: ${validated.error.message.slice(0, 256)}`,
      });
    }
    existing = validated.data;
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      exists = false;
    } else if (cause instanceof InstallMCPClientConfigError) {
      throw cause;
    } else {
      throw new InstallMCPClientConfigError(
        { path: target, message: (cause as Error).message ?? 'read failed' },
        cause,
      );
    }
  }

  const mutated: MCPClientConfigFile = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      corpus: {
        command: args.corpusBinaryPath,
        args: ['mcp'],
      },
    },
  };

  // Atomic write via withTempDir then rename across the same FS via path.dirname.
  await fs.mkdir(path.dirname(target), { recursive: true });
  await withTempDir(
    async (dir) => {
      const tmp = path.join(dir, 'config.json');
      await fs.writeFile(tmp, JSON.stringify(mutated, null, 2) + '\n', 'utf8');
      await fs.rename(tmp, target);
    },
    { signal, namespace: 'sp007-mcp-config' },
  );

  // Re-validate the post-write file (defense per Constitution V).
  const postBody = await fs.readFile(target, 'utf8');
  const post = MCPClientConfigFileZodSchema.safeParse(JSON.parse(postBody));
  if (!post.success) {
    await emitStepFailed('mcp_client_config', startedAt, 'post_write_invalid');
    throw new InstallMCPClientConfigError({
      path: target,
      message: 'post-write file failed Zod re-validation',
    });
  }
  void exists; // existence captured for diagnostics; not used.

  return { path: target, key_added: 'mcpServers.corpus' };
}

async function emitStepFailed(
  step:
    | 'preflight'
    | 'idempotency_check'
    | 'xdg_bringup'
    | 'sqlite_singlefile'
    | 'config_toml'
    | 'taxonomy_seed'
    | 'mcp_client_config'
    | 'firewall_provision'
    | 'auto_start_unit'
    | 'install_receipt'
    | 'next_step_output',
  startedAt: number,
  error_code: string,
): Promise<void> {
  try {
    await emitTelemetry({
      event: 'install.step_failed',
      timestamp: new Date().toISOString(),
      severity: 'error',
      outcome: 'failure',
      step,
      duration_ms: Date.now() - startedAt,
      error_code,
    });
  } catch {
    /* telemetry must not crash install */
  }
}
