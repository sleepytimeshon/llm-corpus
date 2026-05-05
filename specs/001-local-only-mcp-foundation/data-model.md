# Phase 1 — Data Model: Local-Only Enforcement and MCP Server Foundation

**Feature**: 001-local-only-mcp-foundation
**Date**: 2026-05-05

This feature does not introduce *persistent* data (the SQLite index is empty in SP-001; ingest begins SP-003). The data model below describes the *operational* entities — telemetry events, schema-validated tool messages, and build-time configuration — that this feature creates and consumes.

## Entities

### MCPRequest / MCPResponse

The JSON-RPC 2.0 wire format exchanged between an MCP-aware client and the corpus server over stdio.

**Relevant message types in SP-001:**

| Method | Direction | Schema |
|---|---|---|
| `tools/list` | client → server | `{ jsonrpc: "2.0", id, method: "tools/list", params: {} }` |
| `tools/list` (response) | server → client | `{ jsonrpc: "2.0", id, result: { tools: ToolDefinition[] } }` |
| `tools/call` | client → server | `{ jsonrpc: "2.0", id, method: "tools/call", params: { name: "corpus.find", arguments: { query: string, filter?: SearchFilter } } }` (handler stub returns empty SearchHit[] in SP-001) |
| `tools/call` (response) | server → client | `{ jsonrpc: "2.0", id, result: { content: [...] } }` |

**Cold-start error envelope** (per FR-001 / US1.4):

```json
{
  "jsonrpc": "2.0",
  "id": <request_id>,
  "error": {
    "code": -32002,
    "message": "server_initializing",
    "data": { "retry_after_ms": 1000 }
  }
}
```

The `code: -32002` is a JSON-RPC 2.0 server-defined error in the implementation-defined range. `retry_after_ms` is advisory; clients are expected to back off and retry the `tools/list` handshake.

**Validation**: MCP SDK validates JSON-RPC 2.0 envelope; tool argument validation happens via the Zod schema declared at tool registration (see `contracts/mcp-corpus-find.md`).

---

### EgressEvent

A telemetry record describing one outbound network primitive invocation, blocked or successful (loopback only).

**Schema:**

```ts
type EgressEvent = {
  event: 'egress.attempted' | 'egress.blocked' | 'egress.checkpoint';
  timestamp: string;          // ISO-8601 UTC
  primitive:
    | 'net.Socket.connect'
    | 'undici.Dispatcher'
    | 'dgram.send'
    | 'dns.lookup'
    | 'http2.connect'
    | 'tls.connect';
  destination_host: string;   // e.g. "8.8.8.8" or "example.org"; for loopback: "127.0.0.1" / "::1"
  destination_port: number;
  result: 'blocked' | 'loopback';
  doc_id?: string;            // present when the event fires inside a per-document pipeline stage
  pipeline_stage?:
    | 'ingest'
    | 'classify'
    | 'embed'
    | 'index'
    | 'find';                 // present for `egress.checkpoint`; SP-001 ships find-only stages plus stub fixtures
  request_id: string;         // monotonic uuid v7 — for correlation
};
```

**Validation rules:**

1. `primitive` MUST be one of the six enumerated values; the runtime hook covers exactly these six.
2. `result: "loopback"` is permitted; the egress hook does NOT block loopback (`127.0.0.0/8` IPv4, `::1` IPv6, and `localhost` resolution). All other destinations are `blocked`.
3. `event: "egress.checkpoint"` MUST include `pipeline_stage`; this is the proof-of-always-on telemetry per SC-008.
4. `event: "egress.attempted"` is logged BEFORE the hook decides to block — this is the forensic record, regardless of outcome. `event: "egress.blocked"` follows when the decision is to block.
5. Records MUST be ≤4 KB serialized (Constitution Principle IX — append-atomic JSONL).

**Lifecycle:**

- An attempt fires `egress.attempted` (always).
- If destination is non-loopback → `egress.blocked` follows; the call returns a typed error to the caller (does NOT throw uncaught).
- If destination is loopback → no `egress.blocked` event; the call proceeds.
- At every pipeline-stage transition (this feature: stub fixtures simulating future stages) → `egress.checkpoint` fires.

---

### ForbiddenImportSet

The build-time list of network-calling module names that the NFR-001 lint rule scans for.

**v1 contents (immutable for v1.0.0):**

```ts
const FORBIDDEN_IMPORTS: ReadonlySet<string> = new Set([
  // Node built-in network modules
  'node:http',
  'node:https',
  'node:fetch',
  'node:net',                  // outbound; the lint differentiates `net.Server` (allowed) from `net.Socket.connect` callers (forbidden)
  // Cloud SDK families
  '@aws-sdk',                  // matches @aws-sdk/* prefix
  '@azure',                    // matches @azure/* prefix
  '@google-cloud',             // matches @google-cloud/* prefix
  'openai',
  '@anthropic-ai',             // matches @anthropic-ai/* prefix
  'cohere-ai',
  // HTTP clients
  'axios',
  'got',
  'node-fetch',
  'cross-fetch',
  // Loopback-only HTTP libraries are NOT forbidden — undici is permitted as a dependency because we PATCH its Dispatcher; see ADR-001
]);
```

**Scan scope:**

- `packages/pipeline/`, `packages/storage/`, `packages/index/`, `packages/inference/`, `packages/extract/` — the build-time-boundary packages.
- `packages/transport/` and `packages/daemon/` are NOT in scope for the import lint because they HOST the egress hook (which patches `undici.Dispatcher`); they need access to undici to monkey-patch it. They get covered by the runtime hook itself.
- `packages/cli/` is in scope.
- Test files (`*.test.ts`, `*.spec.ts`, `tests/**`) are out of scope — tests intentionally exercise forbidden primitives to verify they're blocked.

**Promotion path**: Adding a new forbidden import is a code change to `FORBIDDEN_IMPORTS` plus a constitution-amendment-class review (Principle I covers this surface). Removing one (relaxing the rule) requires a Constitution amendment per Governance.

---

### NativeAddonAllowlist

The build-time set of permitted `.node` addons that may be bundled.

**v1 contents:**

```ts
const NATIVE_ADDON_ALLOWLIST: ReadonlySet<string> = new Set([
  'better-sqlite3',
  'sqlite-vec',
]);
```

**Enforcement**: A `build:verify-native-addons` script enumerates `.node` files under `node_modules/` after install, maps each back to its containing package via the `package.json` directory walk, and fails the build if any package outside the allowlist contributes a `.node` file.

**Promotion path**: Adding a new addon requires (a) explicit code change to `NATIVE_ADDON_ALLOWLIST`, (b) Constitution Check on the affected feature plan citing Principle I and the rationale for the new addon. No implicit promotion.

---

### ForbiddenPathLiteral

The build-time set of regex patterns that NFR-XIV's lint rule rejects.

**v1 patterns:**

- `^/data/` — prevents accidental writes to a system /data root
- `llm-corpus/` (when not part of the `Paths` resolver source file) — prevents hardcoded project-name paths
- `os.tmpdir\(\)` — prevents tmp writes outside `Paths.cache()` (per Principle VIII tmp-dir lifecycle)
- `path\.join\(.*?'/tmp` / `path\.join\(.*?'/var` — prevents dynamic path construction outside `Paths.*`

**Scope**: All TypeScript source files under `packages/` EXCEPT `packages/contracts/src/paths.ts` (the resolver itself).

---

### BootstrapManifest (declarative load order)

Records which modules MUST be imported before which others, enforced at runtime by a startup-order test (per SC-007).

**v1 contents:**

```ts
const BOOTSTRAP_ORDER: ReadonlyArray<string> = [
  'packages/transport/src/egress-hook.ts',  // FIRST — must register before any other import
  'packages/contracts/src/paths.ts',         // pure types + path resolver
  'packages/contracts/src/result.ts',
  'packages/contracts/src/telemetry.ts',
  // ...everything else
];
```

**Verification**: a startup-order test imports modules in reverse order and asserts that the egress hook is still registered before any pipeline package (catches regressions where someone adds a top-level import that pulls in pipeline before the hook has registered).

## State Transitions

This feature has one minor state machine: the MCP server lifecycle.

```text
              ┌──────────────┐
              │   stopped    │
              └──────┬───────┘
                     │ corpus mcp (CLI subcommand)
                     ▼
              ┌──────────────┐
              │  bootstrapping  │  egress hook registers here
              └──────┬───────┘
                     │ index init complete
                     ▼
              ┌──────────────┐
              │    ready     │  tools/list returns corpus.find
              └──────┬───────┘
                     │ stdin EOF or SIGTERM
                     ▼
              ┌──────────────┐
              │  shutting    │
              │   down       │
              └──────┬───────┘
                     │
                     ▼
                  stopped
```

While in `bootstrapping`, `tools/list` returns `code: -32002, message: "server_initializing"` per FR-001 / US1.4. The transition to `ready` happens once the hook is registered AND the (empty in SP-001) index is open AND the SDK has registered the `corpus.find` tool.

`shutting down` flushes any pending telemetry writes (the JSONL stream) before exiting.
