# Contract — Runtime Egress Hook API

**Feature**: 001-local-only-mcp-foundation
**Status**: SP-001 — full implementation. The hook is the load-bearing primitive of NFR-002.
**ADR reference**: [ADR-001](../../../.product/ADRs/ADR-001-runtime-egress-hook.md) — In-Process Node Runtime Egress Hook (Six Outbound Primitives).

## Surface API

```ts
import type { Disposable } from 'node:disposablestack';

/**
 * Install the in-process egress hook by monkey-patching six outbound primitives
 * at module-load time. MUST be called from the entry-point bootstrap BEFORE any
 * pipeline package import. Returns a Disposable that, when disposed, restores
 * original behavior — used only in tests; production never disposes.
 *
 * Calling installEgressHook() more than once in a process throws
 * `EgressHookAlreadyInstalledError` (defensive — multiple installs would
 * compound interception layers and corrupt forensic telemetry).
 */
export function installEgressHook(opts?: HookOptions): Disposable;

export interface HookOptions {
  /** Optional per-call hook for tests to observe interception decisions. */
  onAttempt?: (attempt: AttemptContext) => void;

  /**
   * Override the loopback classifier for tests. Production uses the default
   * (CIDR check on 127.0.0.0/8 IPv4 + exact match on ::1 IPv6 + DNS-resolved
   * hostname loopback check).
   */
  classifyDestination?: (host: string, port: number) => 'loopback' | 'remote';
}

export interface AttemptContext {
  primitive: Primitive;
  host: string;
  port: number;
  classification: 'loopback' | 'remote';
  request_id: string;
}

export type Primitive =
  | 'net.Socket.connect'
  | 'undici.Dispatcher'
  | 'dgram.send'
  | 'dns.lookup'
  | 'http2.connect'
  | 'tls.connect';
```

## Per-primitive interception signatures

The hook patches each primitive's call boundary. Patches MUST preserve the original method's full type signature; behavior change is limited to the loopback-vs-remote decision and the `EgressBlockedError` throw on remote.

| Primitive | Patched method | Decision input |
|---|---|---|
| `net.Socket.connect` | `Socket.prototype.connect(options, ...)` | `options.host || options[0]` |
| `undici.Dispatcher` | `Dispatcher.prototype.dispatch(opts, handler)` | `new URL(opts.origin || opts.url).hostname + .port` |
| `dgram.send` | `Socket.prototype.send(msg, ...args, addr)` | `addr` parameter |
| `dns.lookup` | `dns.lookup(hostname, ...)` | `hostname` (then post-resolution check) |
| `http2.connect` | `http2.connect(authority, ...)` | `new URL(authority).hostname + .port` |
| `tls.connect` | `tls.connect(options, ...)` | `options.host || options.servername` |

For `dns.lookup` specifically: the patch lets the lookup proceed (DNS itself MUST work for loopback hostnames like `localhost`), but if the resolved address is non-loopback AND the hostname is not in the user-configured `trusted_loopback_hostnames` list (default: `['localhost']`), it throws `EgressBlockedError` after resolution. The hook does NOT block DNS lookup itself — it blocks the *resolution outcome* against non-loopback IPs.

## Loopback classification

```ts
function isLoopbackIPv4(ip: string): boolean {
  // 127.0.0.0/8 — any IP starting with 127.
  return /^127\.\d+\.\d+\.\d+$/.test(ip);
}

function isLoopbackIPv6(ip: string): boolean {
  return ip === '::1' || ip === '0:0:0:0:0:0:0:1';
}

function classifyHost(host: string, port: number): 'loopback' | 'remote' {
  // Direct IP — classify by literal
  if (isLoopbackIPv4(host) || isLoopbackIPv6(host)) return 'loopback';
  // Hostname — must be 'localhost' OR resolve to loopback (post-DNS check)
  if (host === 'localhost') return 'loopback';
  // Everything else — remote
  return 'remote';
}
```

The `dns.lookup` post-resolution check uses the same `isLoopbackIPv4` / `isLoopbackIPv6` predicates against the resolved IP address.

**Trusted loopback hostnames** are configurable via `Paths.configFile()` (`config.toml` key `network.trusted_loopback_hostnames`). v1 default: `['localhost']`. The user MAY add hostnames like `host.docker.internal` if they need to route loopback through a proxy, but the hostname's resolution MUST land in 127/8 or ::1 — the hook re-checks at resolution time.

## EgressBlockedError contract

```ts
export class EgressBlockedError extends Error {
  readonly code = 'EGRESS_BLOCKED';
  readonly name = 'EgressBlockedError';
  constructor(
    readonly primitive: Primitive,
    readonly destination_host: string,
    readonly destination_port: number,
    readonly request_id: string,
  ) {
    super(
      `Egress to ${destination_host}:${destination_port} via ${primitive} blocked by local-only enforcement (NFR-002, ADR-001). request_id=${request_id}`,
    );
  }
}
```

The error is thrown synchronously from the patched primitive. Async primitives wrap it in their normal error-propagation channel (e.g., `undici.Dispatcher.dispatch` rejects the returned promise; `net.Socket.connect` emits `'error'` event with the `EgressBlockedError`).

## Tool handler contract (Cancellable IO — Constitution Principle VII)

The `corpus.find` tool handler in `packages/transport/src/corpus-find-tool.ts` MUST accept an `AbortSignal`:

```ts
import type { z } from 'zod';
import type { CorpusFindInput, CorpusFindOutput } from './schemas';

export type CorpusFindHandler = (
  input: z.infer<typeof CorpusFindInput>,
  signal: AbortSignal,
) => Promise<z.infer<typeof CorpusFindOutput>>;

// SP-001 implementation:
export const corpusFindHandler: CorpusFindHandler = async (input, signal) => {
  signal.throwIfAborted();
  return { hits: [], query: input.query };  // empty in SP-001
};
```

Future SP-005 ranking extension MUST propagate the signal through to FTS5 + sqlite-vec calls and to any async work; cancellation at the SDK layer MUST cause the in-flight call to abort within 2 seconds (per ARCHITECTURE-FINAL §11.2).

## Bootstrap ordering contract

```ts
// packages/transport/src/index.ts (entry-point)
//
// FIRST IMPORT — registers patches before any other module load:
import { installEgressHook } from './egress-hook';
installEgressHook();   // synchronous; throws if already installed

// All subsequent imports happen AFTER patches are live:
import { startMcpServer } from './mcp-server';
import { Paths } from '@llm-corpus/contracts';
// ... etc

startMcpServer({ /* ... */ });
```

Tests `tests/integration/bootstrap-order.test.ts` assert this discipline by spawning a Node child with strategically-positioned import-time `console.log` instrumentation; the hook's installation banner MUST appear before any pipeline-package banner.

## Worker-thread guard contract

```ts
// packages/daemon/src/worker-spawn-guard.ts
import { Worker, type WorkerOptions } from 'node:worker_threads';

export function spawnGuardedWorker(
  filename: string,
  opts?: WorkerOptions,
): Worker {
  // Inject the bootstrap-shim path as a preload via execArgv.
  const execArgv = [
    '--require', require.resolve('@llm-corpus/daemon/worker-bootstrap'),
    ...(opts?.execArgv ?? []),
  ];
  return new Worker(filename, { ...opts, execArgv });
}

// Refusal: direct `new Worker(...)` calls are FORBIDDEN.
// Lint rule rejects `new Worker(` outside this helper.
```

The bootstrap shim (`packages/daemon/src/worker-bootstrap.ts`) calls `installEgressHook()` first thing inside the Worker process, before any user-supplied Worker code runs.

## Build-time enforcement contracts

| Concern | Enforcement | Location |
|---|---|---|
| Forbidden imports (NFR-001) | eslint custom rule `no-forbidden-network-imports` | `eslint.config.js` + `tools/eslint-rules/no-forbidden-network-imports.ts` |
| `process.exit` in libraries (Const. XI) | eslint custom rule `no-process-exit-in-libs` | same |
| Path literals outside resolver (Const. XIV) | eslint custom rule `paths-from-resolver-only` | same |
| Native-addon allowlist | post-install script `build/verify-native-addons.ts` | `package.json` `postinstall` hook |
| Worker spawn outside helper | eslint custom rule `no-direct-worker-spawn` | same |
| `execSync` / string-formed shell (Const. XII) | eslint plugin `no-shell-string-exec` (built-in `no-restricted-syntax` rule with custom selector) | same |

All build-time enforcement is in CI; PRs that violate any rule cannot merge.

## Test seams (per Architecture §3 "the seam test")

```ts
// Production: real hook, real network primitives
installEgressHook();

// Tests: real hook, observed via onAttempt callback
const observed: AttemptContext[] = [];
using disposable = installEgressHook({
  onAttempt: (ctx) => observed.push(ctx),
});

// Tests with classification override (e.g., to simulate non-loopback hostname):
using disposable = installEgressHook({
  classifyDestination: (host) => host === 'fake-remote.test' ? 'remote' : 'loopback',
});
```

Tests dispose the hook between cases via `using` (TC39 explicit-resource-management). Production never disposes.
