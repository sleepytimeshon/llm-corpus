# Implementation Plan: Install + 90-Second First-Run UX — `npx @llm-corpus/cli init`, Uninstall, OS-Firewall Provisioning, Single-File SQLite, CLI-Triable Failure Lane, Cold-Start Vocabulary Seed + `corpus taxonomy promote`

**Branch**: `007-install-first-run`
**Date**: 2026-05-15
**Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `specs/007-install-first-run/spec.md`

## Summary

Ship the **install owner** for the SP-001..SP-006 substrate — the install-completion sprint that turns the post-SP-006 substrate (feature-complete on `main` at squash `5237916`) into a one-command operator-installable product. Four orthogonal deliverables in one sprint, all CLI-only / idempotent / Zod-validated / AbortSignal-bounded / drain-lock-serialized where they mutate shared state:

1. **`npx @llm-corpus/cli init` — single-command first-run UX inside a 90-second AbortController budget**. A publishable `@llm-corpus/cli` npm package exposes a single `corpus` binary; `corpus init` performs preflight (Node ≥ 18, Ollama reachable at loopback, XDG writable, no partial-install debris), creates the XDG subtree exclusively via `Paths.*` getters, opens a single-file SQLite index per NFR-010 (WAL checkpoint + sidecar unlink at exit), writes a Zod-validated default `config.toml`, bulk-inserts a curated ≤ 50-term taxonomy seed (≥ 25-term floor from the SP-006 USER-GUIDE.md workaround list) with `state='established'` via `INSERT OR IGNORE` (idempotent), appends a `mcpServers.corpus` entry to `~/.claude.json` (or `--mcp-client-config <path>`) atomically via `withTempDir`, provisions the ADR-001 path (b) UID-scoped OS firewall rule via `runTool('pfctl', [...])` (macOS) / `runTool('iptables', [...])` (Linux), optionally installs a systemd user unit or launchd plist (opt-in via `--enable-autostart`, default OFF), writes a Zod-validated `install-receipt.json` at `Paths.state()`, and prints next-step instructions — all within an enforced 90-second `setTimeout + clearTimeout + controller.abort('install_budget_exceeded')` budget per Constitution VII. An optional `--smoke` flag triggers a C-046 end-to-end smoke harness (spawn the production binary, daemon up, drop a deterministic seed doc into `Paths.inbox()`, wait for `edges-build.completed` telemetry, spawn a real `corpus mcp` child and invoke `corpus.find` via real MCP-stdio, assert ≥ 1 SearchHit) with its own 30-second sub-budget exempt from the 90-second non-smoke ceiling.

2. **`corpus uninstall` — receipt-driven, deterministic, reversible**. Consults `Paths.state() + '/install-receipt.json'`, Zod-validates it, then reverses every recorded side-effect: MCP-client entry removed (preserving other entries; written back atomically); OS firewall rule reversed via the receipt's recorded `reverse_command` invoked through `runTool()`; auto-start unit (if recorded) disabled and removed. XDG subtree is preserved by default per TR-002; removed only with `--purge`. Idempotent re-runs consult the receipt's reverse-list incrementally; SIGINT mid-flow marks the receipt partial-uninstalled for resumption. Emits a post-uninstall verification summary (filesystem diff + firewall query + MCP-client diff) suitable for bug reports.

3. **`corpus taxonomy promote` — operator-driven proposed→established elevation, closing C-045**. Accepts `--axis=<domain|type|tag|source_type>` + `--term <t>` (repeatable) OR `--from-proposed-with-count-ge=<N>` (mutually exclusive, enforced by Zod). Acquires `Paths.drainLock()` via `flock(LOCK_EX | LOCK_NB)` BEFORE mutating `taxonomy_terms` (Constitution IX — preserves the FR-INGEST-011 / FR-CLASSIFY-015 / FR-RETRIEVAL-018 lock-contention contract across the new mutation surface), transitions rows from `state='proposed'` to `state='established'` and sets `established_at=datetime('now')` in a single transaction, emits per-term confirmation, releases the lock, exits 0. Idempotent (already-established is a no-op); missing-term is a non-zero exit with a clear error; unknown axis is a Zod-rejection at parse time.

4. **C-046 end-to-end smoke harness — `packages/cli/test/smoke-e2e.test.ts`**. The transport-cutover-gap-closer per the SP-006 retrospective F-1 root cause. Builds the CLI, spawns the production binary against a tempdir HOME, runs the full `init --smoke` flow, and asserts the SearchHit comes back over real MCP-stdio — not a library-handler test. Conditionally skipped in CI when Ollama is absent; runs unconditionally locally.

SP-007 is honest about what it produces (install + uninstall + taxonomy-promote + smoke harness + execution journal, all CLI-only on the mutation surface; ZERO new MCP mutations; ZERO new SQL tables; ZERO new `Paths.*` getters; ZERO new outbound non-loopback endpoints at runtime) and what it defers (C-043 `signals_used: []` + C-044 `summary` column → post-SP-007 polish PR with FR-INSTALL-026 / FR-INSTALL-027 rationale; Windows, bundled Ollama, GUI installer, multi-tenant, D-027 migration, cross-agent registration, auto-update, telemetry shipping, containerized install, `corpus taxonomy demote/delete` → out of scope). SP-007 is the install-completion sprint: after merge, a fresh operator on a clean machine runs one command and has a working corpus in ≤ 90 seconds — the SP-008 user-acceptance Maya-engagement-proxy gate can run from that clean install end-to-end.

## Technical Context

**Language/Version**: TypeScript 5.5+ (strict mode). Node.js 20 LTS primary, 22 LTS forward-compatible. The `npx @llm-corpus/cli init` flow requires Node ≥ 18.0.0 at the OPERATOR boundary (per FR-INSTALL-003 preflight + NFR-014 verbatim); the build / test toolchain remains Node 20 per the monorepo's `engines.node >= 20`. Inherits SP-001..SP-006 toolchain unchanged.

**Primary Dependencies** (additive over SP-001 + SP-002 + SP-003 + SP-004 + SP-005 + SP-006):

- `zod ^3.23.0` (existing) — `InstallReceiptZodSchema`, `InstallReceiptUninstalledZodSchema`, `TaxonomySeedEntryZodSchema`, `TaxonomySeedZodSchema`, `MCPClientConfigEntryZodSchema`, `MCPClientConfigFileZodSchema`, `FirewallRuleSpecZodSchema`, `AutoStartUnitSpecZodSchema`, `TaxonomyPromoteArgsZodSchema`, `InstallPreflightResultZodSchema`, `InstallCliArgsZodSchema`, `UninstallCliArgsZodSchema` live in `packages/contracts/src/install-schemas.ts` (NEW file). SP-007 telemetry event classes added to the `TelemetryEvent` discriminated union additively (≥ 12 new classes).
- `better-sqlite3 ^11.2.0` (existing) — single-file SQLite open in WAL mode + `PRAGMA wal_checkpoint(TRUNCATE)` + WAL/SHM sidecar unlink at install exit per FR-INSTALL-006; transactional `INSERT OR IGNORE` of the curated taxonomy seed; transactional `UPDATE taxonomy_terms SET state='established', established_at=datetime('now')` for the promote subcommand. No new SQL tables — the schema delta is ZERO (the substrate schema is frozen post-SP-006).
- `sqlite-vec ^0.1.0` (existing) — present for the substrate; not exercised at install time except for the schema-migrate step that ensures `documents_vec` exists (idempotent).
- `node:fs/promises` (built-in) — XDG `mkdir({recursive: true})`, install-receipt write/read, MCP-client config read/parse/write, taxonomy seed JSON load from `packages/cli/src/install-resources/taxonomy-seed.json`, auto-start unit file writes, smoke-fixture copy into `Paths.inbox()`.
- `node:child_process` (built-in) — via the EXISTING `runTool(cmd, args[], opts)` helper from SP-001 (Constitution XII). NEW external commands invoked at install/uninstall time: `pfctl` (macOS), `iptables` (Linux), `systemctl` (Linux + `--enable-autostart`), `launchctl` (macOS + `--enable-autostart`), `sudo` (when not root and root required for firewall), `corpus daemon start` / `corpus daemon stop` / `corpus mcp` (smoke harness sub-spawns). ZERO new MCP surfaces; ZERO string-formed shell commands; the `no-shell-string-exec` ESLint rule (SP-001) scopes over SP-007 source.
- `node:os` (built-in) — `os.userInfo().uid` capture for the UID-scoped firewall rule; `os.platform()` discrimination for the macOS-vs-Linux provisioning paths; `os.homedir()` for the MCP-client config default `~/.claude.json` (recorded explicitly outside `Paths.*` and noted in the install-receipt per Constitution XIV).
- `node:crypto` (built-in) — install-receipt content-hash for idempotent diff detection on re-install (the receipt's hash lets the install short-circuit identical re-runs).
- Existing `withTempDir` helper from SP-001 — atomic install-receipt write, atomic MCP-client config rewrite (Constitution VIII).
- Existing `Paths.*` getter surface from SP-001 — ZERO new getters per the dispatch prompt's "SP-007 must NOT introduce new XDG bases" discipline + SC-007-031.
- Existing `runTool(name, args[], opts)` helper from SP-001 — sole subprocess entry point (Constitution XII + ADR-009).
- Existing `openIndexReadWrite` helper from SP-001 — opens the SQLite index, runs the migration set, leaves the DB in single-file form after the explicit `PRAGMA wal_checkpoint(TRUNCATE)` and WAL/SHM unlink that SP-007 adds.
- Built-in arg parsing — NEW dependency rejected: SP-007 extends the EXISTING `packages/cli/src/index.ts` subcommand dispatcher (`mcp`, `daemon`, `drain`, `reenrich`, `reindex`) with the additional verbs (`init`, `uninstall`, `taxonomy promote`, `failures`) using a small in-package arg parser. No `commander` / `yargs` / `meow` dependency — those introduce a new transitive surface; the current dispatcher pattern is sufficient for the new verb count.

**Storage**: SP-007 adds ZERO SQL tables and ZERO new XDG bases. The curated taxonomy seed is INSERTed into the existing SP-004 `taxonomy_terms` table with `state='established'` via `INSERT OR IGNORE` (idempotent across re-installs); the `corpus taxonomy promote` mutation is an UPDATE on the SAME `taxonomy_terms` table. The install-receipt is a single JSON file at `Paths.state() + '/install-receipt.json'` (NEW write target — a flat-file artifact in an existing XDG base, like SP-006's `.recovery.error.json` sidecars relative to the SP-003 sidecars). The MCP-client config (`~/.claude.json` by default) is the ONLY path the install touches outside `Paths.*`; recorded explicitly in the install-receipt per Constitution XIV. Drain-lock at `Paths.drainLock()` (reused) gates the seed insert and the promote UPDATE.

**Testing**: vitest (inherits SP-001..SP-006). New SP-007 test surfaces:

- (a) `tests/unit/install-schemas.test.ts` — Zod round-trip for `InstallReceiptZodSchema`, `TaxonomySeedZodSchema`, `MCPClientConfigEntryZodSchema`, `FirewallRuleSpecZodSchema`, `AutoStartUnitSpecZodSchema`, `TaxonomyPromoteArgsZodSchema`, `InstallPreflightResultZodSchema`, `InstallCliArgsZodSchema`, `UninstallCliArgsZodSchema`;
- (b) `tests/unit/install-preflight.test.ts` — Node-version check, Ollama-reachability check (loopback stub), XDG-writable check, partial-install detection;
- (c) `tests/unit/install-xdg-bringup.test.ts` — `Paths.*` getter accumulator asserts every path created during install is `Paths.*`-derivable (Constitution XIV gate);
- (d) `tests/unit/install-sqlite-singlefile.test.ts` — WAL checkpoint + WAL/SHM unlink leaves the install-exit footprint at exactly one `.db` file (NFR-010 gate);
- (e) `tests/unit/install-config-toml.test.ts` — default `config.toml` writes and Zod-validates against the existing `ConfigTomlZodSchema`;
- (f) `tests/unit/install-taxonomy-seed.test.ts` — curated-seed JSON loads and Zod-validates; bulk-insert is `INSERT OR IGNORE` (idempotent on re-run); ≥ 25 terms, ≤ 50 terms;
- (g) `tests/unit/install-mcp-client-config.test.ts` — append-corpus-entry preserves other entries; create-from-scratch when file absent; atomic via `withTempDir`; malformed JSON aborts before any other side-effect;
- (h) `tests/unit/install-firewall-provisioner.test.ts` — `runTool('pfctl', ...)` args + `runTool('iptables', ...)` args; idempotent re-provision (existing-rule detection); reverse-command capture into receipt;
- (i) `tests/unit/install-auto-start-unit.test.ts` — systemd unit file contents + launchd plist contents; `--enable-autostart` opt-in default OFF; conflict-detection with operator-authored unit;
- (j) `tests/unit/install-receipt.test.ts` — receipt write is atomic; Zod-validates at write + read; idempotent re-write updates `installed_at` but preserves side-effect list;
- (k) `tests/unit/install-budget-enforcement.test.ts` — synthetic-delay injection forces 90-second timeout → `controller.abort('install_budget_exceeded')` → non-zero exit (Constitution VII + SC-007-034);
- (l) `tests/unit/install-rollback.test.ts` — step-N failure unwinds via the receipt's reverse-list (steps 1..N-1 reversed); the unwind itself is idempotent;
- (m) `tests/unit/uninstall-receipt-driven.test.ts` — receipt-driven reverse of MCP-client + firewall + auto-start; XDG preserved by default; `--purge` removes XDG + receipt;
- (n) `tests/unit/uninstall-missing-receipt.test.ts` — missing or malformed receipt → non-zero exit + clear-remediation message + ZERO destructive operations;
- (o) `tests/unit/uninstall-idempotent-resume.test.ts` — SIGINT mid-flow marks receipt partial-uninstalled; re-run consults reverse-list incrementally and skips already-reversed side-effects (Constitution X);
- (p) `tests/unit/uninstall-firewall-reverse.test.ts` — receipt's recorded `reverse_command` invoked via `runTool()`; post-uninstall firewall query returns empty;
- (q) `tests/unit/taxonomy-promote-args.test.ts` — Zod parsing of `--axis`/`--term`/`--from-proposed-with-count-ge`; mutual exclusivity enforced; unknown axis rejected;
- (r) `tests/unit/taxonomy-promote-sql.test.ts` — UPDATE transitions proposed→established; sets `established_at`; idempotent on already-established; non-zero exit on missing term;
- (s) `tests/unit/taxonomy-promote-lock-contention.test.ts` — drain-lock held by stub-daemon → `pipeline.lock_contention` emitted + non-zero exit + ZERO SQL writes;
- (t) `tests/unit/install-telemetry-classes.test.ts` — Zod round-trip for ≥ 12 new SP-007 event classes;
- (u) `tests/integration/install-end-to-end.test.ts` — `CORPUS_HOME=<tempdir>` fixture: spawn `node <dist>/bin/corpus.js init` against a clean HOME; assert XDG subtree created, SQLite single-file, receipt valid, MCP-client entry registered, firewall rule present (or stubbed if CI not root), exit 0, wall-clock ≤ 90 s;
- (v) `tests/integration/install-rerun-idempotent.test.ts` — run install twice; second run prints "already initialized" + preserves all side-effects + exits 0;
- (w) `tests/integration/uninstall-end-to-end.test.ts` — install + capture filesystem/firewall/MCP-client state; uninstall (no flag); diff confirms reversal of MCP-client + firewall + auto-start with XDG preserved; uninstall `--purge` removes everything;
- (x) `tests/integration/taxonomy-promote-end-to-end.test.ts` — install + seed proposed terms via stub-classifier path + run promote + assert `taxonomy_terms` state transitions + assert subsequent `corpus reenrich` re-classifies stuck rows;
- (y) `tests/integration/failure-lane-cli-triage.test.ts` — drives each NFR-006 failure mode from `.product/ACCEPTANCE-CRITERIA.feature` lines 1076-1417; asserts every failure mode has a CLI triage path through `corpus://failures` + `corpus taxonomy promote` + `corpus reenrich`; produces `specs/007-install-first-run/execution-journal.md` (SC-007-023);
- (z) **`packages/cli/test/smoke-e2e.test.ts` — C-046 end-to-end smoke (per dispatch prompt mandate)**. Builds the CLI via the existing `tsc --build`; spawns the BUILT binary `node <dist>/bin/corpus.js init --smoke` with `CORPUS_HOME=<tempdir>`; the install's step-12 smoke drops a deterministic seed doc into `Paths.inbox()`, polls telemetry for `edges-build.completed`, spawns a real `corpus mcp` child speaking MCP-stdio, invokes `corpus.find({query: '<deterministic-query>'})` via real MCP, asserts the response has ≥ 1 SearchHit pointing at the seed body; tears down daemon and MCP child; cleans the tempdir. Conditionally skipped when Ollama is absent (with a clear `it.skipIf(!ollamaReachable)` annotation and a log line); runs unconditionally locally with Ollama. **This test is the SP-006 retrospective F-1 closer — no library-level handler test is sufficient.**

**Target Platform**: Linux (Fedora 43+ baseline; tested on pai-node01) and macOS (Apple Silicon + Intel — Big Sur+ for `pfctl` anchor support). Windows OUT OF SCOPE for v1 (the `pfctl` / `iptables` / `systemd` / `launchd` provisioning paths don't translate; Windows would require a separate Windows-Firewall + Windows-Service provisioning path; future-horizon per spec.md Out of Scope). The `npx` flow requires Node ≥ 18.0.0 at the operator boundary (per FR-INSTALL-003 + NFR-014); the monorepo build/test toolchain remains Node 20 LTS per `package.json` `engines.node >= 20`.

**Project Type**: TypeScript monorepo (npm workspaces). SP-007 extends two existing packages and adds ZERO new packages:

- `packages/contracts/` — adds `install-schemas.ts` (≥ 9 new Zod schemas — see Primary Dependencies); extends `telemetry.ts` with ≥ 12 new SP-007 event classes additively in the `TelemetryEvent` discriminated union; extends `errors.ts` with ≥ 10 new typed errors (`InstallPreflightError`, `InstallFirewallProvisionError`, `InstallMCPClientConfigError`, `InstallReceiptWriteError`, `InstallBudgetExceededError`, `UninstallReceiptMissingError`, `UninstallFirewallReverseError`, `TaxonomyPromoteLockContentionError`, `TaxonomyPromoteMissingTermError`, `TaxonomyPromoteArgsError`).
- `packages/cli/` — adds `src/install-command.ts` + `src/uninstall-command.ts` + `src/taxonomy-promote-command.ts` (new CLI entry points, the ONLY layer permitted to `process.exit` per Constitution XI); adds `src/install-helpers/` directory with library helpers (preflight, XDG bringup, sqlite-singlefile, config-toml-writer, taxonomy-seed-loader, mcp-client-config-mutator, firewall-provisioner, auto-start-unit-installer, install-receipt-writer, install-receipt-reader, install-budget, install-rollback); adds `src/install-resources/taxonomy-seed.json` (curated ≤ 50-term seed); adds `fixtures/first-run-seed.md` (deterministic 1-paragraph English fixture for `--smoke`); adds `test/smoke-e2e.test.ts` (C-046 harness); extends `src/index.ts` subcommand dispatcher with `init` / `uninstall` / `taxonomy promote` verbs.

No new package directory. The substrate packages (`contracts`, `daemon`, `index`, `inference`, `pipeline`, `storage`, `transport`) are untouched by SP-007 beyond the `contracts` extensions.

Reasoning: a separate `packages/install/` was considered and rejected — the install logic is operationally bound to the CLI verbs (`init`, `uninstall`, `taxonomy promote`) and shares no API surface with any other package. A new package would add workspace-resolution overhead without isolating any meaningful surface. The substrate-package discipline ("each package has ZERO new MCP surfaces") is preserved by keeping SP-007 entirely in `packages/cli/` + the `packages/contracts/` schema extensions.

**Performance Goals**:

**90-second cold-install budget** (FR-INSTALL-002 + NFR-014 + SC-007-001 — enforced ceiling, not target, per Constitution XVI):

| Step | Sub-budget (target) | Honest commitment | Measurement |
|---|---|---|---|
| 0. `npx` package fetch | 0 s (outside corpus runtime per ADR-001 §"Origin") | n/a — bounded by user's npm registry latency | bounded by npm |
| 1. Preflight (Node + Ollama loopback + XDG writable + partial debris) | < 2 s | < 5 s | fixture timing |
| 2. Idempotency short-circuit (re-install path) | < 100 ms | < 500 ms | fixture timing |
| 3. XDG subtree creation (`mkdir -p` × 12 dirs) | < 500 ms | < 2 s | fixture timing |
| 4. SQLite open + migration + WAL checkpoint + sidecar unlink | < 3 s | < 10 s | fixture timing |
| 5. `config.toml` write (Zod-validated) | < 100 ms | < 500 ms | fixture timing |
| 6. Curated seed insert (≤ 50 `INSERT OR IGNORE` in one txn) | < 200 ms | < 1 s | fixture timing |
| 7. MCP-client config mutate (atomic `withTempDir`) | < 200 ms | < 1 s | fixture timing |
| 8. Firewall provision (`runTool('pfctl' \| 'iptables', ...)`) | < 3 s | < 10 s | fixture timing |
| 9. Auto-start unit (opt-in, skipped by default) | < 1 s when enabled | < 3 s when enabled | fixture timing |
| 10. Install-receipt write (atomic `withTempDir`) | < 200 ms | < 500 ms | fixture timing |
| 11. Next-step output | < 50 ms | < 100 ms | fixture timing |
| **Total non-smoke (1-11) p95** | **< 30 s** | **< 90 s (enforced)** | wall-clock `time` |
| 12. `--smoke` (Ollama-dependent; exempt from 90 s) | n/a | < 30 s (own budget) | wall-clock `time` |

**90-second budget enforcement**: `setTimeout(() => controller.abort('install_budget_exceeded'), 90000)` + `clearTimeout(handle)` on successful step-11 completion. NEVER `Promise.race(setTimeout)` (Constitution VII forbidden pattern). SIGINT propagates through the master AbortSignal and unwinds via the install-receipt's reverse-list (Constitution X idempotent transitions).

**`corpus taxonomy promote` performance** (FR-INSTALL-014 — single SQL UPDATE in a transaction; bounded by drain-lock acquisition latency):

- Drain-lock acquisition (non-blocking `flock(LOCK_EX | LOCK_NB)`): < 10 ms when uncontended; immediate non-zero exit on contention.
- `UPDATE taxonomy_terms SET state='established'` for ≤ 100 terms: < 50 ms.
- Total per invocation: < 100 ms typical.

**`corpus uninstall` performance** (FR-INSTALL-015 — sequential reverse of recorded side-effects):

- MCP-client config rewrite (atomic): < 200 ms.
- Firewall reverse (`runTool` invocation): < 3 s typical.
- Auto-start unit teardown (when recorded): < 1 s.
- XDG subtree removal with `--purge` (`fs.rm({recursive: true})`): < 5 s for typical corpora; bounded by inode count.
- Total p95 (no `--purge`): < 5 s. With `--purge`: < 10 s.

**C-046 smoke harness** (FR-INSTALL-013 — its own 30-second sub-budget exempt from the 90-second ceiling):

- Daemon spawn + PID-file appearance: < 3 s.
- Seed-doc traversal (validation → classify → embed → index → edges-build) bounded by SP-004 classifier budget (~10 s on pai-node01 with `qwen3:8b`) + SP-005 embed budget (~2 s) + SP-005 index budget (~1 s): < 20 s typical, 30 s hard ceiling.
- Real MCP-stdio `corpus.find` round-trip: < 1 s typical.
- Daemon teardown: < 2 s.
- Total p95: < 25 s.

All numbers are TARGETS not guarantees per Constitution XVI. Empirical p95s recorded in the "Performance Goals (Honest Commitments)" table post-implementation.

**Constraints**:

- Zero outbound non-loopback endpoints introduced by SP-007 at runtime (Constitution I, hard — the only outbound call during install is the FR-INSTALL-003 preflight loopback Ollama-reachability GET; the `npx` package download happens at the npm-registry layer BEFORE `corpus init` runs and is outside NFR-002's scope per ADR-001 §"Origin of these alternatives"; the OS-firewall hook installed at step 8 engages post-install).
- Zero new MCP mutation surfaces (Constitution III, hard — `corpus init`, `corpus uninstall`, `corpus taxonomy promote` are CLI subcommands, NOT MCP tools; the SP-006 `corpus://failures` read-only resource is unchanged; SC-007-027 lint).
- Zero new SQL tables (the substrate schema is frozen post-SP-006; SP-007 inserts into existing `taxonomy_terms` and updates the same table).
- Zero new `Paths.*` getters (Constitution XIV, hard — SC-007-031 + `git diff main -- packages/contracts/src/paths.ts` should show no new exports for SP-007).
- Every IO call accepts `AbortSignal` and propagates it (Constitution VII, hard — SC-007-029 + lint).
- The install / uninstall / taxonomy-promote subcommands ALL respect `Paths.drainLock()` semantics where they mutate `taxonomy_terms` (Constitution IX, hard — the install acquires the lock for the seed-insert transaction; the promote acquires it for the UPDATE; concurrent CLI invocations during a held lock emit `pipeline.lock_contention` and exit non-zero).
- Every state transition emits a Zod-validated telemetry event (Constitution XIII, hard — ≥ 12 new SP-007 event classes; SC-007-033 + lint).
- Every external command (`pfctl`, `iptables`, `systemctl`, `launchctl`, `sudo`, `corpus daemon start`, `corpus mcp`) invoked via `runTool(cmd, args[], opts)` with an arg array (Constitution XII, hard — `no-shell-string-exec` lint over SP-007 source).
- No `process.exit` outside `packages/cli/src/install-command.ts`, `packages/cli/src/uninstall-command.ts`, `packages/cli/src/taxonomy-promote-command.ts` (Constitution XI, hard — `no-process-exit-in-libs` lint).
- Telemetry records ≤ 4096 bytes (Constitution IX, hard).
- Sudo password prompt is handled by `runTool()`'s stdin/stderr inheritance, NEVER logged in telemetry (Constitution I + SC-RETRIEVAL-016-inherited; SC-007-033 verification).
- The install-receipt's `corpus_binary_path` is captured at install time via `process.argv[1]` → `realpath` (or `process.execPath` for `npx`-cached); if the operator moves the binary post-install, the operator re-runs `corpus init` to refresh.

**Scale/Scope**:

- Single user, single machine (Constitution IV).
- Net new code: ~1500-2000 LOC implementation, ~1500-2000 LOC tests + fixtures.
- Net new files: 3 CLI command files (install-command.ts, uninstall-command.ts, taxonomy-promote-command.ts), ~14 install-helpers files, 1 contracts schema file (install-schemas.ts), 1 curated seed JSON (taxonomy-seed.json), 1 fixture markdown (first-run-seed.md), ~3 contracts extensions (telemetry.ts + errors.ts + index.ts re-exports), ~26 test files (20 unit + 5 integration + 1 smoke harness).
- Per-feature contract files: 4 NEW ADRs (install/uninstall surface, firewall provisioning, taxonomy promote CLI, curated seed) + 0 amended ADRs. ADR-001 is REFERENCED but not amended (the firewall-provisioning ADR is a NEW companion ADR that operationalizes ADR-001's path (b) commitment without superseding it).

**Sizing call**: SP-007 sits at the 2000-LOC / 15-file threshold per `feedback-build-tier-sizing-rule`. Production surface alone (~1500-2000 LOC across ~17 source files) is at-or-just-above threshold; total surface with tests + fixtures is ~3000-4000 LOC across ~45 files. The four deliverables (install, uninstall, taxonomy promote, smoke harness) are orthogonal and the install-helpers/* directory is internally cohesive; per `feedback-build-tier-sizing-rule`, the spec.md Assumptions section explicitly commits to "SP-007 single-engineer-agent build per `feedback-build-tier-sizing-rule`; total surface ~2000-2500 LOC; pre-split into N≥2 invocations only if plan-stage research expands the surface above the threshold." Plan-stage research (Decisions A-E in research.md) did not expand the surface; **recommend single-phase build** when `/speckit-implement` runs, with `/simplify` + `feature-dev:code-reviewer` review before merge. If during build the surface exceeds 2000 LOC implementation OR 15 source files, the build is pre-split into 2 Engineer agent invocations (split point: (a) install-command + install-helpers + smoke harness vs (b) uninstall-command + taxonomy-promote-command + integration tests + execution journal).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

For each principle, mark `[x]` if the plan complies, `[ ]` if it does not (and populate Complexity Tracking with a justification). All 16 principles MUST be `[x]` for the plan to merge unchallenged.

- [x] **I. Local-First, No Egress** — SP-007 introduces ZERO new outbound non-loopback endpoints at runtime. The ONLY outbound call during the entire install flow is the FR-INSTALL-003 preflight Ollama-reachability GET against `http://127.0.0.1:11434/api/tags` (loopback-only — Principle I preserved). The `npx` package download happens at the npm-registry layer BEFORE `corpus init` ever runs and is therefore outside NFR-002's scope per ADR-001 §"Origin of these alternatives" (the one-time install bootstrap is a documented allowed exception; post-install the SP-001 in-process egress hook engages + the ADR-001 path (b) UID-scoped OS firewall rule engages). The OS firewall rule provisioned at install-step-8 is the runtime-egress-blocker; SP-007 INSTALLS the rule, it does not weaken it. Telemetry records absolute paths, durations, step names, OS/version, never network destinations. SC-007-026 lint gate.
- [x] **II. User Curates, LLM Classifies Metadata** — SP-007 introduces ZERO new LLM body-generation. The curated taxonomy seed (FR-INSTALL-008) is human-curated by Shon at SP-007 plan-stage from the SP-006 USER-GUIDE.md workaround list; the install bulk-inserts it. The `corpus taxonomy promote` CLI is operator-curated (operator chooses which proposed terms to elevate). The `--smoke` step's seed document at `packages/cli/fixtures/first-run-seed.md` is a human-authored 1-paragraph English-language fixture. No LLM-generated body content is written by SP-007.
- [x] **III. Substrate, Not Surface** — SC-007-027 + FR-INSTALL-023 commit to ZERO new MCP mutation surfaces. The new CLI subcommands (`corpus init`, `corpus uninstall`, `corpus taxonomy promote`) are CLI-only, NOT MCP-exposed. The existing SP-002 four resources + SP-006 `corpus://failures` are read-only and unchanged. SP-007 changes `corpus.find`'s discoverability surface only (adds the registration entry to the MCP-client config; does NOT change the tool itself). No HTTP server. No TUI. No browser. No graphical output.
- [x] **IV. Knowledge, Not Memory; Single-User, Single-Machine** — Assumptions explicit (spec.md): one corpus per user per machine. The install captures `os.userInfo().uid` and provisions a UID-scoped firewall rule. No multi-user provisioning. No cross-machine sync. No SaaS connector. No permissions / roles. No federation.
- [x] **V. Schema-Enforced Structured Output** — FR-INSTALL-020 + SC-007-028 bind every install / uninstall / taxonomy-promote input and output to Zod schemas in `packages/contracts/src/install-schemas.ts` (NEW): `InstallReceiptZodSchema`, `TaxonomySeedZodSchema` / `TaxonomySeedEntryZodSchema`, `MCPClientConfigEntryZodSchema` / `MCPClientConfigFileZodSchema`, `FirewallRuleSpecZodSchema`, `AutoStartUnitSpecZodSchema`, `TaxonomyPromoteArgsZodSchema`, `InstallPreflightResultZodSchema`, `InstallCliArgsZodSchema`, `UninstallCliArgsZodSchema`. The existing `ConfigTomlZodSchema` (SP-001+) validates the default `config.toml` write. Defense-in-depth: install-receipt is Zod-validated at write time AND at read time (uninstall preflight). The MCP-client config file's JSON is Zod-validated before mutating + after mutating. The curated taxonomy seed is Zod-validated before insert. No regex-extraction from free-form text. No hand-rolled JSON parsing.
- [x] **VI. One Pipeline, Two Policies** — The `--smoke` end-to-end harness (FR-INSTALL-013) invokes the SAME `ingestStage` / `classifyStage` / `embedStage` / `indexStage` / `edgesBuildStage` pipeline that production uses (no per-test stub pipeline; the daemon spawned by the smoke runs the production library functions); the smoke uses `batchPolicy` per the SP-003 daemon-policy contract. The smoke does not fork the pipeline. One pipeline, one policy at smoke time.
- [x] **VII. Cancellable, Bounded IO** — FR-INSTALL-017 + SC-007-029 + SC-007-034 commit to AbortSignal propagation through every install / uninstall / taxonomy-promote IO operation. The install's 90-second budget is enforced via `setTimeout(() => controller.abort('install_budget_exceeded'), 90000)` + `clearTimeout` on cascade completion (NEVER `Promise.race(setTimeout)` — Constitution VII forbidden pattern); the smoke's 30-second sub-budget is enforced the same way; SIGINT aborts in-flight steps and unwinds via the receipt. The `runTool()` invocation of `pfctl`/`iptables`/`systemctl`/`launchctl`/`sudo` propagates AbortSignal to the subprocess.
- [x] **VIII. Atomic Writes & Transactional Index Updates** — The install-receipt is written atomically via `withTempDir` (FR-INSTALL-012); the MCP-client config mutation is written back atomically via `withTempDir` (FR-INSTALL-009). The single SQLite index is committed transactionally per the SP-005 index-persister contract (preserved). The curated taxonomy seed is inserted in a single transaction (`BEGIN IMMEDIATE → INSERT OR IGNORE × ≤ 50 → COMMIT`) (FR-INSTALL-008). The `corpus taxonomy promote` UPDATE is wrapped in a single transaction. The smoke-harness daemon shutdown via `corpus daemon stop` is a clean SIGTERM (Constitution VII bounded 2-second exit).
- [x] **IX. Concurrency-Safe Shared State** — FR-INSTALL-014 + SC-007-022 bind `Paths.drainLock()` acquisition by `corpus taxonomy promote` BEFORE mutating `taxonomy_terms`; concurrent CLI invocations during a held lock emit `pipeline.lock_contention` and exit non-zero (the SP-003 / SP-004 / SP-005 / SP-006 contract preserved across the new taxonomy-mutation surface). The install acquires the drain-lock for its single seed-insert transaction (preserving the same contract). Read paths (the install's preflight loopback Ollama-reachability GET; the smoke's `corpus.find` over real MCP) are NOT gated by the drain-lock (Constitution III substrate reads are non-blocking; SP-006 contract preserved). Telemetry JSONL records ≤ 4 KB per record (Constitution IX, hard).
- [x] **X. Idempotent Pipeline Transitions** — FR-INSTALL-004 (install on existing install: re-runs the preflight + re-validates each side-effect + prints "already initialized" + exits 0; the seed insert is `INSERT OR IGNORE` so re-running is a no-op; the MCP-client config merge is set-semantic; the firewall provisioning is tag-keyed and skip-if-present; the auto-start unit re-write is overwrite-if-identical), FR-INSTALL-014 (taxonomy promote: already-established term is a no-op with `"already established: <axis>/<term>"` stdout; missing term is a non-zero exit with ZERO SQL writes), FR-INSTALL-017 (uninstall: idempotent re-run consults receipt's reverse-list incrementally, already-reversed side-effects skipped per Constitution X). SP-007 is idempotent across all flows (install, uninstall, taxonomy promote).
- [x] **XI. Library/CLI Boundary** — FR-INSTALL-019 + SC-007-032 commit to `process.exit` only in `packages/cli/src/install-command.ts`, `packages/cli/src/uninstall-command.ts`, and `packages/cli/src/taxonomy-promote-command.ts`. Library helpers under `packages/cli/src/install-helpers/` return `Result<T, E>` or throw typed errors (`InstallPreflightError`, `InstallFirewallProvisionError`, `InstallMCPClientConfigError`, `InstallReceiptWriteError`, `InstallBudgetExceededError`, `UninstallReceiptMissingError`, `UninstallFirewallReverseError`, `TaxonomyPromoteLockContentionError`, `TaxonomyPromoteMissingTermError`, `TaxonomyPromoteArgsError`). The SP-001 `no-process-exit-in-libs` ESLint rule is scoped over SP-007 source.
- [x] **XII. Subprocess Hygiene** — FR-INSTALL-018 + SC-007-030 commit to every external command (`pfctl`, `iptables`, `systemctl`, `launchctl`, `sudo`, `corpus daemon start`, `corpus daemon stop`, `corpus mcp`) invoked via `runTool(cmd, args[], opts)` with an arg array; ZERO string-formed shell commands. The args are explicit arrays (`['-a', 'corpus', '-f', '-']` for `pfctl`; `['-A', 'OUTPUT', '-m', 'owner', '--uid-owner', '<uid>', ...]` for `iptables`; etc.). The `<uid>` is a numeric literal from `os.userInfo().uid`. The `<rule-text>` for pfctl's stdin is JSON-encoded. The `<path>` arguments are literal `Paths.*` values. The SP-001 `no-shell-string-exec` lint scopes over SP-007 source. The sudo password prompt is handled by `runTool()`'s stdin/stderr inheritance per ADR-009.
- [x] **XIII. Telemetry-or-Die** — FR-INSTALL-021 + SC-007-033 commit to ≥ 12 new SP-007 event classes across install + uninstall + taxonomy-promote (`install.preflight_failed`, `install.step_failed`, `install.completed`, `install.smoke_started`, `install.smoke_completed`, `install.smoke_failed`, `uninstall.preflight_failed`, `uninstall.step_failed`, `uninstall.completed`, `taxonomy.promote_completed`, `taxonomy.promote_lock_contention`, `taxonomy.promote_missing_term`); every catch block emits a telemetry event before returning or re-throwing (existing AST-level lint covers SP-007 — verified by code-grep in `tests/unit/install-telemetry-classes.test.ts`). Each event Zod-validates against the existing `TelemetryEvent` discriminated union (additive variants). Telemetry NEVER includes secrets (the sudo password prompt is handled by `runTool()`'s stdin inheritance, never logged).
- [x] **XIV. XDG Paths via Single Resolver** — FR-INSTALL-005 + SC-007-006 + SC-007-031 commit to every install / uninstall path routing through `Paths.*`; ZERO new `Paths.*` getters in SP-007 (verified by `git diff main -- packages/contracts/src/paths.ts` returning no new exports). The MCP-client config path (`~/.claude.json` by default; `--mcp-client-config <path>` override) is the only path the install touches outside `Paths.*` and is recorded explicitly in the install-receipt. The `paths-from-resolver-only` lint scopes over SP-007 source.
- [x] **XV. Dynamic Taxonomy with User-Reviewed Promotion** — The `corpus taxonomy promote` CLI subcommand IS the user-reviewed-promotion surface for v1 (Principle XV explicitly requires user review for taxonomy growth). The curated seed (FR-INSTALL-008) is a one-time human-curated bootstrap, NOT auto-promotion (the seed is curated by Shon at SP-007 plan-stage from the SP-006 USER-GUIDE.md workaround list). Auto-promotion is FORBIDDEN by Principle XV; SP-007 introduces ZERO auto-promotion. Promote operations are Zod-validated (per Principle V) and atomic (per Principle VIII).
- [x] **XVI. Validation Honesty** — SC-007-034 commits to the 90-second budget as an enforced CEILING, not a marketing target; the install fails non-zero if exceeded (verified by `tests/unit/install-budget-enforcement.test.ts` with synthetic delay injection). The seed term count (≥ 25, ≤ 50) is bounded by the dispatch prompt's "≤ 50-term seed" cap (FR-INSTALL-008). All performance numbers in the "Performance Goals" table are TARGETS; empirical p95s are recorded post-implementation. No cross-agent compatibility claims (only Claude Code's `~/.claude.json` is registered per the spec.md Assumptions). No formal eval harness as v1 success criterion. The C-046 smoke is the substantive runtime gate, not a marketing claim.

**Result**: 16/16 [x]. Complexity Tracking: empty.

## Project Structure

### Documentation (this feature)

```
specs/007-install-first-run/
├── plan.md          # This file (/speckit-plan command output)
├── research.md      # Phase 0 output (/speckit-plan command)
├── data-model.md    # Phase 1 output (/speckit-plan command)
├── quickstart.md    # Operator walkthrough (npx init + uninstall + taxonomy promote + smoke) — produced post-/speckit-tasks
├── contracts/       # Phase 1 output (/speckit-plan command)
│   ├── adr-install-uninstall-surface.md
│   ├── adr-firewall-provisioning.md
│   ├── adr-taxonomy-promote-cli.md
│   └── adr-curated-seed.md
├── checklists/
│   └── requirements.md
├── execution-journal.md  # Produced during SP-007 build per SC-007-023 (NFR-006 triage-scenario catalog)
└── tasks.md         # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```
packages/
├── contracts/
│   └── src/
│       ├── install-schemas.ts            # NEW — InstallReceiptZodSchema, TaxonomySeedZodSchema, MCPClientConfigEntryZodSchema, FirewallRuleSpecZodSchema, AutoStartUnitSpecZodSchema, TaxonomyPromoteArgsZodSchema, InstallPreflightResultZodSchema, InstallCliArgsZodSchema, UninstallCliArgsZodSchema
│       ├── telemetry.ts                  # EXTENDED — ≥ 12 new SP-007 event classes additively in TelemetryEvent discriminated union
│       ├── errors.ts                     # EXTENDED — ≥ 10 new typed errors (InstallPreflightError, InstallFirewallProvisionError, InstallMCPClientConfigError, InstallReceiptWriteError, InstallBudgetExceededError, UninstallReceiptMissingError, UninstallFirewallReverseError, TaxonomyPromoteLockContentionError, TaxonomyPromoteMissingTermError, TaxonomyPromoteArgsError)
│       └── index.ts                      # EXTENDED — re-exports of new install-schemas + new error classes
└── cli/
    ├── src/
    │   ├── index.ts                       # EXTENDED — subcommand dispatcher adds `init` / `uninstall` / `taxonomy promote` verbs (existing `mcp` / `daemon` / `drain` / `reenrich` / `reindex` unchanged)
    │   ├── install-command.ts             # NEW — `corpus init` entry point; THE ONLY layer permitted to process.exit for install flow (Constitution XI)
    │   ├── uninstall-command.ts           # NEW — `corpus uninstall` entry point; THE ONLY layer permitted to process.exit for uninstall flow
    │   ├── taxonomy-promote-command.ts    # NEW — `corpus taxonomy promote` entry point; THE ONLY layer permitted to process.exit for promote flow
    │   ├── install-helpers/
    │   │   ├── preflight.ts               # NEW — Node-version + Ollama-loopback + XDG-writable + partial-debris checks; returns InstallPreflightResult
    │   │   ├── xdg-bringup.ts             # NEW — fs.mkdir({recursive: true}) of every Paths.*-derivable XDG path; returns the list of created paths for the receipt
    │   │   ├── sqlite-singlefile.ts       # NEW — openIndexReadWrite + migrate + PRAGMA wal_checkpoint(TRUNCATE) + unlink WAL/SHM sidecars; NFR-010 enforcement
    │   │   ├── config-toml-writer.ts      # NEW — write default config.toml at Paths.configFile() with SP-004/005/006 defaults; Zod-validate before write
    │   │   ├── taxonomy-seed-loader.ts    # NEW — load packages/cli/src/install-resources/taxonomy-seed.json; Zod-validate as TaxonomySeedZodSchema; bulk INSERT OR IGNORE in single transaction
    │   │   ├── mcp-client-config-mutator.ts  # NEW — read ~/.claude.json (or --mcp-client-config <path>); parse; append/update mcpServers.corpus entry; write back atomically via withTempDir
    │   │   ├── firewall-provisioner.ts    # NEW — provision UID-scoped OS firewall rule via runTool('pfctl', ...) (macOS) or runTool('iptables', ...) (Linux); idempotent (existing-rule detection); capture reverse-command for receipt
    │   │   ├── auto-start-unit-installer.ts  # NEW — write systemd user unit (Linux) or launchd plist (macOS) when --enable-autostart is provided; opt-in; capture reverse-command
    │   │   ├── install-receipt-writer.ts  # NEW — assemble InstallReceipt from accumulated side-effects; Zod-validate; write atomically via withTempDir
    │   │   ├── install-receipt-reader.ts  # NEW — read Paths.state() + '/install-receipt.json'; Zod-validate; surface schema-mismatch errors as UninstallReceiptMissingError
    │   │   ├── install-budget.ts          # NEW — 90-second AbortController + setTimeout/clearTimeout wrapper; SIGINT propagation; NEVER Promise.race(setTimeout)
    │   │   ├── install-rollback.ts        # NEW — on step-N failure, walk the partial-receipt's reverse-list (steps 1..N-1) and invoke each side-effect's reverse-command; idempotent
    │   │   ├── smoke-harness.ts           # NEW — invoked by install-command.ts when --smoke is set; spawns `corpus daemon start`, copies seed doc, polls telemetry for edges-build.completed, spawns `corpus mcp`, invokes corpus.find, asserts ≥ 1 SearchHit, tears down
    │   │   └── taxonomy-promote-helpers.ts  # NEW — args parser, drain-lock acquire, UPDATE statement builder, missing-term checker, already-established no-op handler
    │   └── install-resources/
    │       └── taxonomy-seed.json         # NEW — curated ≤ 50-term seed: 5 domains, 6 types, 9 tags, 5 source_types floor (≥ 25); Zod-validated as TaxonomySeedZodSchema
    ├── fixtures/
    │   └── first-run-seed.md              # NEW — deterministic 1-paragraph English-language fixture for the --smoke step
    └── test/
        └── smoke-e2e.test.ts              # NEW — C-046 end-to-end smoke harness: builds CLI, spawns production binary, runs init --smoke, asserts SearchHit over real MCP-stdio, tears down; conditionally skipped when Ollama is absent

tests/
├── unit/
│   ├── install-schemas.test.ts
│   ├── install-preflight.test.ts
│   ├── install-xdg-bringup.test.ts
│   ├── install-sqlite-singlefile.test.ts
│   ├── install-config-toml.test.ts
│   ├── install-taxonomy-seed.test.ts
│   ├── install-mcp-client-config.test.ts
│   ├── install-firewall-provisioner.test.ts
│   ├── install-auto-start-unit.test.ts
│   ├── install-receipt.test.ts
│   ├── install-budget-enforcement.test.ts
│   ├── install-rollback.test.ts
│   ├── uninstall-receipt-driven.test.ts
│   ├── uninstall-missing-receipt.test.ts
│   ├── uninstall-idempotent-resume.test.ts
│   ├── uninstall-firewall-reverse.test.ts
│   ├── taxonomy-promote-args.test.ts
│   ├── taxonomy-promote-sql.test.ts
│   ├── taxonomy-promote-lock-contention.test.ts
│   └── install-telemetry-classes.test.ts
├── integration/
│   ├── install-end-to-end.test.ts
│   ├── install-rerun-idempotent.test.ts
│   ├── uninstall-end-to-end.test.ts
│   ├── taxonomy-promote-end-to-end.test.ts
│   └── failure-lane-cli-triage.test.ts    # produces specs/007-install-first-run/execution-journal.md per SC-007-023
└── fixtures/
    └── sp007-install/
        ├── taxonomy-seed-fixture.json
        ├── claude-json-with-prior-entries.json
        ├── claude-json-malformed.json
        ├── partial-install-debris/
        └── README.md
```

**Structure Decision**: SP-007 extends `packages/cli/` with three new CLI command entry points (`install-command.ts`, `uninstall-command.ts`, `taxonomy-promote-command.ts`) + an `install-helpers/` library directory (the ONLY new directory), and extends `packages/contracts/` additively (new `install-schemas.ts`; extensions to `telemetry.ts` + `errors.ts` + `index.ts`). ZERO new packages. ZERO new MCP surfaces. ZERO new `Paths.*` getters. The C-046 smoke lives under `packages/cli/test/` (alongside any future package-local tests) to keep the build-the-package-then-spawn-the-binary harness co-located with the CLI it tests.

## Phase 0 — Research

See [`research.md`](./research.md) for the full decision log. Headlines (Decisions A through E resolved per the dispatch prompt's pre-resolved-decisions block + plan-stage research):

- **A. `npx` distribution strategy** — publish `@llm-corpus/cli` to the public npm registry under the `@llm-corpus/` org scope; rely on the npm prebuild path for `better-sqlite3` + `sqlite-vec` native binaries (Linux x64 + macOS x64 + macOS arm64); no Docker, no compile step. Public registry is preferred over GitHub-hosted or scope-private for the canonical `npx <pkg> init` UX.
- **B. Cross-platform firewall provisioning** — `pfctl` on macOS (Big Sur+ for anchor support) + `iptables` on Linux (Fedora baseline; the `iptables` legacy interface for parity with ADR-001 verbatim, with `nft`-fallback rejected for v1 simplicity). Both invoked via `runTool()`. No fallback when the binary is absent — the install exits non-zero with a clear-remediation message naming the missing binary (rare on the v1 supported platforms).
- **C. `config.toml` shape at first-run** — minimal config: `[classifier].model='qwen3:8b'`, `[embedder].model='nomic-embed-text'`, `[search].min_results=3`, `[search].tier_total_budget_ms=600`, `[ingest].max_doc_size_bytes=<SP-003 default>`, `[telemetry].rotate_at_bytes=<SP-003 default>`. Every value Zod-validated against the existing `ConfigTomlZodSchema`. On re-install over an existing config, the install does NOT overwrite the operator's edits (idempotent per FR-INSTALL-004).
- **D. Curated seed storage** — JSON file at `packages/cli/src/install-resources/taxonomy-seed.json`, bundled into the published package. Versioned with the package (the seed travels with the CLI binary; future seed updates ship with new CLI versions). Zod-validated at install time before insert. Overridable via a future `--seed-file <path>` flag (out-of-scope for v1 per spec.md Out of Scope).
- **E. Auto-start mechanism** — systemd user unit on Linux (`~/.config/systemd/user/corpus.service` + `systemctl --user enable --now corpus.service`); launchd plist on macOS (`~/Library/LaunchAgents/io.llm-corpus.daemon.plist` + `launchctl load <plist>`). Opt-in via `--enable-autostart` flag; default OFF (the 90-second-budget critical-path discipline + operator-surprise avoidance per spec.md Assumptions).

## Phase 1 — Design Artifacts

See [`data-model.md`](./data-model.md) for the entity catalog and the seven SP-007 entities (InstallReceipt, TaxonomySeedEntry, InstallPreflightResult, MCPClientConfigEntry, FirewallRuleSpec, TaxonomyPromoteArgs, InstallTelemetry).

See [`contracts/`](./contracts/) for the four ADRs:

- [`adr-install-uninstall-surface.md`](./contracts/adr-install-uninstall-surface.md) — ADR-012: `corpus init` step pipeline + `corpus uninstall` receipt-driven reverse contract.
- [`adr-firewall-provisioning.md`](./contracts/adr-firewall-provisioning.md) — ADR-013: pfctl/iptables provisioning per ADR-001 path (b); idempotent + reversible; UID-scoped; tagged for clean reversal.
- [`adr-taxonomy-promote-cli.md`](./contracts/adr-taxonomy-promote-cli.md) — ADR-014: `corpus taxonomy promote` arg shape + drain-lock contract + idempotency + interaction with the SP-004 proposed-term routing.
- [`adr-curated-seed.md`](./contracts/adr-curated-seed.md) — ADR-015: curated ≤ 50-term taxonomy seed sourcing + storage format + versioning + override mechanism.

See [`quickstart.md`](./quickstart.md) (produced post-`/speckit-tasks`) for the operator walkthrough (one-command `npx @llm-corpus/cli init` on a clean VM; observe XDG bringup + receipt + firewall; run `corpus init --smoke` and observe the C-046 end-to-end pass; cause a vocabulary-violation failure and triage via `corpus://failures` + `corpus taxonomy promote` + `corpus reenrich`; run `corpus uninstall` and verify reversal; run `corpus uninstall --purge` and verify full removal).

See [`checklists/requirements.md`](./checklists/requirements.md) for the spec-stage 16-principle pass/fail + anti-scope verification.

## PREREQ landings (what must be in `packages/contracts/` before `packages/cli/` work compiles)

Per the substrate's compile-order discipline:

1. **`packages/contracts/src/install-schemas.ts`** — all 9+ new Zod schemas (`InstallReceiptZodSchema`, `InstallReceiptUninstalledZodSchema`, `TaxonomySeedEntryZodSchema`, `TaxonomySeedZodSchema`, `MCPClientConfigEntryZodSchema`, `MCPClientConfigFileZodSchema`, `FirewallRuleSpecZodSchema`, `AutoStartUnitSpecZodSchema`, `TaxonomyPromoteArgsZodSchema`, `InstallPreflightResultZodSchema`, `InstallCliArgsZodSchema`, `UninstallCliArgsZodSchema`). Without these, `packages/cli/src/install-command.ts` cannot compile.
2. **`packages/contracts/src/telemetry.ts`** — extended with the ≥ 12 new SP-007 event-class variants. Without these, the install/uninstall/promote subcommands cannot emit Zod-validated telemetry per Constitution XIII.
3. **`packages/contracts/src/errors.ts`** — extended with the ≥ 10 new typed errors. Without these, the install-helpers cannot return `Result<T, E>` per Constitution XI.
4. **`packages/contracts/src/index.ts`** — re-exports of new install-schemas + new error classes. Without these, `packages/cli/` imports from `@llm-corpus/contracts` cannot resolve.

These four contracts landings are the first build step. They can be authored in a single contracts commit before any cli code is written. The `packages/cli/` work (3 new command files + 14 install-helpers files + 1 resources directory + 1 fixtures directory + 1 test directory + the C-046 smoke harness) follows.

## Risk Register

- **R1 (medium) — `pfctl` / `iptables` permission requires sudo + interactive password prompt during install.** Mitigation: the install detects non-root at preflight; if `sudo` is available, invokes `sudo runTool(...)` with stdin/stderr inherited so the operator can enter the password once. If `sudo` is unavailable, the install exits non-zero with a clear-remediation message naming the manual command. The 90-second budget INCLUDES the sudo password-entry window (acceptable trade-off — the operator is at the terminal during install). Edge case addressed in spec.md Edge Cases.
- **R2 (low) — `~/.claude.json` already contains malformed JSON before install.** Mitigation: the install parses + Zod-validates the file BEFORE any other side-effect; on malformed JSON, exits non-zero with a clear-remediation message; operator fixes the config and re-runs. Edge case addressed in spec.md Edge Cases.
- **R3 (medium) — `npx` cache poisoning / partial download.** Mitigation: the install runs only AFTER npm has resolved + extracted the package; partial downloads fail at the npm-registry layer before `corpus init` is invoked. The install itself is hash-content-addressable (every step's input is the install-receipt's recorded shape; idempotent re-run from a clean slate works).
- **R4 (medium) — Concurrent `corpus init` invocations.** Mitigation: per spec.md Edge Cases, the second invocation observes contention via the SP-003 `Paths.drainLock()` pattern, emits `pipeline.lock_contention`, and exits non-zero. The first completes; the second can be re-run after observing the existing install. The seed-insert transaction is the lock-acquiring step (the rest of the install is non-lock-mutating).
- **R5 (low) — Re-run `corpus init` after partial failure leaves inconsistent state.** Mitigation: the install-receipt is the source-of-truth for "install completed"; a partial install (XDG paths exist but no receipt) is detected by the preflight step which prints "partial install detected at `<paths>`; run `corpus uninstall --purge` to clean up, then re-run `corpus init`" and exits non-zero. Documented in spec.md Edge Cases.
- **R6 (medium) — Auto-start unit conflict with an operator-authored unit (e.g., the Pallas-side D-027 install left a hand-written unit).** Mitigation: the install detects the conflict and exits non-zero with `--force-autostart` remediation; the operator can also opt out via `--no-autostart`. Documented in spec.md Edge Cases.
- **R7 (low) — Lost install-receipt blocks uninstall.** Mitigation: the receipt-driven path is the supported flow; manual fallback (operator-driven `rm -rf` + `pfctl -F` + `jq` edits) is documented. Future-horizon: a `corpus uninstall --force` flag that scans the XDG subtree and infers side-effects without a receipt (out-of-scope for SP-007 per spec.md).
- **R8 (medium) — Active daemon during `corpus uninstall --purge`.** Mitigation: the uninstall detects the active daemon (PID file in `Paths.state()`), invokes `corpus daemon stop`, waits for the Constitution VII 2-second shutdown budget, then proceeds. If the daemon doesn't stop, the uninstall exits non-zero with a clear-remediation message. Documented in spec.md Edge Cases.
- **R9 (low) — `corpus taxonomy promote` race with the classifier.** Mitigation: the classifier holds a read lock during classify calls; the promote acquires `Paths.drainLock()` via `flock(LOCK_EX | LOCK_NB)`; on contention emits `pipeline.lock_contention` and exits non-zero. The promote is fast (single SQL UPDATE); operator-perceived latency is negligible. Documented in spec.md Edge Cases.
- **R10 (medium) — `--smoke` step exceeds its 30-second sub-budget.** Mitigation: the smoke is exempt from the 90-second non-smoke budget but bounded by its own 30 seconds; on overrun, the smoke fails with a clear-remediation message; the non-smoke install (steps 1-11) is already complete and SUCCESSFUL. The operator can retry the smoke manually. Documented in spec.md Edge Cases.
- **R11 (low) — NFR-010 single-file enforcement vs WAL mode during runtime.** Mitigation: per spec.md Edge Cases, the install's NFR-010 commitment is measured at install-exit (WAL checkpoint + sidecar unlink); during daemon runtime the sidecars exist transiently — NOT a violation per NFR-010's "file-level backup/copy/move" framing. The on-disk surface after `corpus daemon stop` is one file.
- **R12 (medium) — Curated seed conflicts with an operator's prior `taxonomy_terms` entries.** Mitigation: the seed uses `INSERT OR IGNORE`; existing entries are NOT modified. The seed is purely additive. Documented in spec.md Edge Cases.

## Performance Goals (Honest Commitments — Constitution XVI)

| Metric | Target (Spec) | SP-007 Honest Commitment | Measurement |
|---|---|---|---|
| `npx init` cold-install (non-smoke, steps 1-11) p95 | ≤ 30 s | ≤ 90 s (enforced ceiling) | wall-clock `time` |
| Preflight p95 | < 2 s | < 5 s | fixture timing |
| XDG bringup p95 | < 500 ms | < 2 s | fixture timing |
| SQLite open + migrate + WAL checkpoint + sidecar unlink p95 | < 3 s | < 10 s | fixture timing |
| `config.toml` write p95 | < 100 ms | < 500 ms | fixture timing |
| Seed insert p95 (≤ 50 rows in one txn) | < 200 ms | < 1 s | fixture timing |
| MCP-client config mutate p95 | < 200 ms | < 1 s | fixture timing |
| Firewall provision p95 (`runTool` + sudo) | < 3 s | < 10 s | fixture timing |
| Install-receipt write p95 | < 200 ms | < 500 ms | fixture timing |
| `corpus uninstall` (no `--purge`) p95 | < 5 s | < 15 s | fixture timing |
| `corpus uninstall --purge` p95 | < 10 s | < 30 s | fixture timing |
| `corpus taxonomy promote` (≤ 100 terms) p95 | < 100 ms | < 500 ms | fixture timing |
| `--smoke` end-to-end p95 | < 25 s | < 30 s (sub-budget ceiling) | wall-clock `time` |

Specific empirical p95s recorded post-implementation in this footnote.

## Complexity Tracking

*Empty (16/16 Constitution principles pass without exception).*

## Phase Gates

- **Phase 0 → Phase 1 gate**: All Decisions A through E resolved in research.md.
- **Phase 1 → Phase 2 gate**: Constitution Check 16/16 [x]; data-model.md entities specified; contracts/ ADRs authored (ADR-012, ADR-013, ADR-014, ADR-015 — all NEW; ADR-001 REFERENCED but not amended).
- **Phase 2 → Phase 3 gate** (post-/speckit-tasks): tasks.md authored; tasks coverage-matrix covers every FR-INSTALL and SC-007.
- **Phase 3 → merge gate** (post-/speckit-implement): all tasks complete; npm run build + lint + test all green; the C-046 smoke harness passes on a dev machine with Ollama; quickstart walked; CLAUDE.md "SP-007 surface" section added; execution-journal.md authored covering every NFR-006 failure mode.

## Progress Tracking

- [x] Phase 0 — Research complete (research.md)
- [x] Phase 1 — Design artifacts complete (data-model.md, contracts/, checklists/requirements.md; quickstart.md deferred to post-/speckit-tasks)
- [ ] Phase 2 — Tasks generated (tasks.md) — pending `/speckit-tasks`
- [ ] Phase 3 — Implementation complete — pending `/speckit-implement`
- [ ] Phase 4 — Merge to main — pending all phase gates
