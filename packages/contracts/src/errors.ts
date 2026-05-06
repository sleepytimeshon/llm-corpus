// T019 — Typed error classes used across packages.
// Constitution XI (Library/CLI Boundary): library code returns Result.err(<typed-error>);
// it never throws ad-hoc Error or process.exit.

import type { PrimitiveType } from './telemetry.js';

/**
 * Thrown by the runtime egress hook when a non-loopback destination is
 * attempted. Synchronous from the patched primitive; async primitives wrap
 * it in their normal error-propagation channel.
 *
 * See contracts/egress-hook-api.md §"EgressBlockedError contract".
 */
export class EgressBlockedError extends Error {
  readonly code = 'EGRESS_BLOCKED' as const;
  override readonly name = 'EgressBlockedError';

  constructor(
    readonly primitive: PrimitiveType,
    readonly destination_host: string,
    readonly destination_port: number,
    readonly request_id: string,
  ) {
    super(
      `Egress to ${destination_host}:${destination_port} via ${primitive} ` +
        `blocked by local-only enforcement (NFR-002, ADR-001). request_id=${request_id}`,
    );
  }
}

/**
 * Thrown when `installEgressHook()` is called more than once in a process.
 * Multiple installs would compound interception layers and corrupt forensic
 * telemetry (see contracts/egress-hook-api.md §"installEgressHook").
 */
export class EgressHookAlreadyInstalledError extends Error {
  readonly code = 'EGRESS_HOOK_ALREADY_INSTALLED' as const;
  override readonly name = 'EgressHookAlreadyInstalledError';

  constructor() {
    super(
      'installEgressHook() may only be called once per process. ' +
        'Re-installing would compound interception and corrupt telemetry.',
    );
  }
}

/**
 * Returned (as Result.err) from `runTool()` when a subprocess fails.
 */
export class ToolInvocationError extends Error {
  override readonly name = 'ToolInvocationError';

  constructor(
    readonly code: 'EXIT_NONZERO' | 'SPAWN_FAILED' | 'ABORTED' | 'TIMEOUT',
    readonly tool: string,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
    cause?: unknown,
  ) {
    super(
      `runTool(${tool}, [${args.join(', ')}]) failed: ${code} (exit=${exitCode}). stderr=${stderr.slice(0, 256)}`,
    );
    if (cause !== undefined) {
      // Node 16+ Error#cause; preserve for diagnostics.
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Thrown when a Zod-validated payload fails schema validation in a non-telemetry
 * context (e.g., MCP tool input parsing). Telemetry has its own
 * `TelemetryValidationError` in `telemetry.ts`.
 */
export class SchemaValidationError extends Error {
  override readonly name = 'SchemaValidationError';

  constructor(
    readonly schemaName: string,
    readonly details: string,
    cause?: unknown,
  ) {
    super(`Schema validation failed for ${schemaName}: ${details}`);
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}
