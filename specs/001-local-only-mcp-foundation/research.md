# Phase 0 — Research: Local-Only Enforcement and MCP Server Foundation

**Feature**: 001-local-only-mcp-foundation
**Date**: 2026-05-05

This document consolidates the technical decisions that gate feature 001's implementation. Most decisions were already settled in `.product/ADRs/ADR-001-runtime-egress-hook.md` (status: accepted, 2026-04-26) and `ARCHITECTURE-FINAL.md` (frozen at git tag `pre-speckit-archive`). research.md does not re-litigate accepted decisions; it (a) summarizes them with current rationale, (b) resolves the small remaining set of toolchain-choice questions, and (c) records what was deliberately deferred.

## Decisions imported from ADR-001 (already accepted)

### Runtime egress hook — six outbound primitives

- **Decision**: Patch `net.Socket.connect`, `undici.Dispatcher`, `dgram.send`, `dns.lookup`, `http2.connect`, `tls.connect` at module-load time in the entry-point bootstrap.
- **Rationale**: NFR-001 (static lint) blocks forbidden imports at compile time but cannot prevent transitive native deps or runtime-loaded modules. NFR-002 closes the gap. The six primitives cover all Node-level outbound paths that a JS-land code path can reach.
- **Alternatives considered**: (a) static lint only — misses Worker threads, dynamic imports, child_process, native addons; (b) OS firewall only — strong defense-in-depth but doesn't prevent JS-land *attempts*; (c) eBPF/USDT — defeated by Node JIT per Stage 2 Research; (d) hybrid — chosen approach combining JS-land hook + OS firewall + native-addon allowlist.
- **Reference implementation pattern**: NodeShield (arXiv 2508.13750) per ADR-001.

### OS-level firewall (defense in depth)

- **Decision**: UID-scoped rule installed automatically by the install script (TR-001 / SP-007). Rule shape: `block out proto {tcp, udp} from any to any user <corpus-uid>` (macOS pf); `OUTPUT -m owner --uid-owner <corpus-uid> -j REJECT` (Linux iptables).
- **Rationale**: Subprocesses launched via `child_process.spawn` and native-addon raw POSIX socket calls bypass JS-land patching. The OS layer catches them.
- **Deferred to SP-007**: The automated install plumbing. SP-001 verifies the rule's effect via a manually-installed rule for the synthetic child-process test (SC-004); SP-007 replaces manual with automated.

### Native-addon allowlist

- **Decision**: Build-time `build:verify-native-addons` script fails the build if any bundled `.node` addon is outside `{better-sqlite3, sqlite-vec}`.
- **Rationale**: Native addons making raw POSIX socket calls bypass JS-land patching. The v1 allowlist is the two addons the architecture explicitly requires.
- **Promotion path**: Per Constitution Principle XV (analog for taxonomy), allowlist promotion requires explicit code change — no implicit promotion.

### Worker-thread coverage

- **Decision**: Workers MUST register the runtime egress guard in their entry-point. The Worker spawn helper refuses creation if the guard is not pre-registered.
- **Rationale**: A Worker without the guard would be an egress-bypass vector. ADR-001 §Decision.1 explicitly addresses this.

## Decisions made in this research phase

### Toolchain — npm workspaces (monorepo manager)

- **Decision**: npm workspaces (no pnpm, no Bun workspaces, no Lerna).
- **Rationale**: Built into Node 20+; zero install footprint; ARCHITECTURE-FINAL §3 references the monorepo as "npm-managed." pnpm offers better disk efficiency but adds a tool dependency and a non-standard `node_modules` layout that some IDE integrations don't handle. Bun workspaces are noted in the architecture for the SQLite backend (`bun:sqlite`) but the monorepo itself stays on npm to keep the project Node-runtime-first.
- **Alternatives considered**: pnpm (rejected: extra tool); Lerna (rejected: maintenance status); Yarn (rejected: not a meaningful upgrade over npm workspaces in 2026).

### Test runner — vitest

- **Decision**: vitest for unit + integration tests.
- **Rationale**: ESM-native, parallel by default, fast watch mode, TypeScript via esbuild. Compatible with the integration rigs for tcpdump/Worker/firewall (those are spawned subprocess tests, not in-process). Built-in coverage. The Node 20+ built-in test runner is a viable alternative but lacks the watch ergonomics and the test-fixture helpers vitest provides.
- **Alternatives considered**: Node test runner (rejected: ergonomics + watch); Jest (rejected: ESM-on-Node is still painful in 2026, even after years of work); Mocha+chai (rejected: more setup, no watch by default).

### MCP TypeScript SDK — `@modelcontextprotocol/sdk`

- **Decision**: Use the official SDK from `@modelcontextprotocol/sdk` for the server transport, tool registration, and JSON-RPC handling.
- **Rationale**: The SDK is the canonical MCP implementation per the spec; it handles the protocol details (stdio framing, JSON-RPC 2.0, tool/resource/prompt registration, schema validation hooks). Hand-rolling the protocol would be unnecessary work and a divergence risk.
- **Verification at implementation time**: confirm the SDK version pinned in package.json matches the MCP spec version the tooling ecosystem (Claude Code, Inspector) is targeting.

### Schema library — Zod

- **Decision**: Zod for the `corpus.find` tool input/output schemas, telemetry event shapes, and frontmatter validation (forward-looking).
- **Rationale**: The whitepaper and ARCHITECTURE-FINAL specify "Zod-derived JSON Schema" for the classifier's grammar-enforced output (Principle V). Using Zod for this feature's MCP tool schema keeps a single schema library across the project. Zod's `.shape` and `.toJsonSchema()` integrations support both runtime validation and JSON-Schema export for the MCP tool advertisement.
- **Alternatives considered**: ArkType (rejected: smaller ecosystem, less MCP tooling integration as of 2026); raw JSON Schema (rejected: redundant with the Zod runtime validators we'd still need; two schemas drift).

### Lint stack — eslint + custom rules

- **Decision**: eslint with custom rules for: (a) forbidden-network-imports (NFR-001), (b) no-process-exit-in-libraries (Constitution XI), (c) catch-block-emits-telemetry-event (Constitution XIII), (d) paths-from-resolver-only (Constitution XIV).
- **Rationale**: eslint is the default TS/JS lint stack; custom rules are well-supported. The forbidden-import rule is a basic AST scan against an import-source allowlist. The catch-block-telemetry rule is more involved but is well-precedented (see eslint-plugin-promise, eslint-plugin-functional).
- **Alternatives considered**: Biome (rejected: custom rule support immature for our needs in 2026); dprint+ts-eslint-only (rejected: not enough rule coverage).

### Telemetry sink — append-only JSONL via fs.appendFile

- **Decision**: Telemetry events are appended to `Paths.telemetry()` (an `.jsonl` file) using `fs.appendFile()`. Records are kept ≤4 KB to ensure POSIX `O_APPEND` atomicity (Constitution Principle IX).
- **Rationale**: Per ARCHITECTURE-FINAL §11 and §12, telemetry is a JSONL stream. `fs.appendFile` with `O_APPEND` is atomic for writes ≤PIPE_BUF (4 KB on Linux). The egress event schemas (see `contracts/telemetry-egress-events.md`) fit comfortably under this size.

## Deliberately deferred to future features

- **The `corpus.find` ranking and SearchHit construction** (FR-002, FR-003, FR-004) — SP-005.
- **The full NFR-016 telemetry surface** (≥6 event classes including ingest/classify/index/search) — SP-003. This feature ships only the egress-class subset.
- **Other MCP resources** (manifest, taxonomy, recent, per-doc) — SP-002.
- **Automated install plumbing for the OS firewall rule** (TR-001) — SP-007.
- **AST-level lint for telemetry-or-die** — Phase-1 deliverable per Constitution Principle XIII; can be implemented in this feature OR deferred to SP-003 when the pipeline emits more events. Decision: implement the AST rule in this feature (it's small, the catch-block scan is straightforward) so SP-003+ inherit a working lint.
- **Bun runtime support** (per ARCHITECTURE-FINAL §3 dual-backend) — Bun is mentioned in the architecture for the SQLite backend; this feature is Node-runtime-first. Bun support is a forward-looking concern, not a SP-001 deliverable.

## Open Questions (none blocking)

- **MCP SDK error-code conventions** — the spec specifies `server_initializing` for `tools/list` cold-start (US1.4). Verify the SDK's recommended error-envelope shape at implementation time; if the SDK provides a typed error class, use it; otherwise emit a JSON-RPC error with `code: -32002` (Server-defined error range, see JSON-RPC 2.0) and `message: "server_initializing"`.
- **Native-addon allowlist enforcement mechanism** — the `build:verify-native-addons` script needs a way to enumerate bundled `.node` files. The Node `binding-rebuild` ecosystem typically copies `.node` files into `node_modules/<pkg>/build/Release/`. The build script can `find` for `*.node` files in `node_modules/` and verify each against the allowlist. Verify at implementation time that this enumeration is deterministic across npm version updates.

Both questions are implementation-time refinements, not blockers.
