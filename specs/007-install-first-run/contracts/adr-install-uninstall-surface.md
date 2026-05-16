# ADR-012 — `corpus init` Install Pipeline + `corpus uninstall` Receipt-Driven Reverse Contract

**Feature**: 007-install-first-run
**Date**: 2026-05-15
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none
**Related ADRs**: ADR-001 (path (b) firewall provisioning); ADR-013 (firewall provisioning); ADR-014 (taxonomy promote CLI); ADR-015 (curated seed)

## Context

SP-001..SP-006 produced a feature-complete substrate (merged on `main` at squash `5237916` on 2026-05-14). The substrate is operationally working on pai-node01 via the Pallas-side advance deliverable D-027 — a bash-shim at `~/.local/bin/corpus`, an XDG subtree at `~/.local/share/llm-corpus/`, a systemd user unit at `~/.config/systemd/user/corpus.service`, and an MCP server registered in `~/.claude.json`. But that install is operator-hostile for anyone but Shon — every install requires the developer to be the operator. TR-001 + NFR-014 (the install + 90-second first-run UX requirement) commit the project to `npx <pkg> init` as the canonical install path, a publishable npm package, a `corpus init` subcommand that the `npx` flow invokes, and a `corpus uninstall` subcommand that reverses every install side-effect deterministically and verifiably.

Without ADR-012:

- The install pipeline is undefined; future operators don't know what `corpus init` does step-by-step.
- The uninstall reverse-list is undefined; uninstall behavior is operator-discoverable instead of contract-driven.
- The install-receipt schema is not committed; future SP-007+ work cannot evolve the receipt without breaking SP-007-era installs.
- The idempotency / rollback semantics are unspecified; partial failures leave the operator with debris.

This ADR codifies the 11-step install pipeline + optional 12th smoke step + the receipt-driven uninstall reverse contract + the install-receipt's Zod-validated shape + the rollback semantics for partial failures.

## Decision

**11-step install pipeline** (steps 3-10 enclosed in a 90-second AbortController budget):

1. **Preflight** — Node ≥ 18.0.0, Ollama reachable on `http://127.0.0.1:11434/api/tags` (loopback-only — Principle I), XDG directories writable, no partial-install debris. Fails BEFORE any side-effect.
2. **Idempotency check** — `Paths.indexDb()` exists AND install-receipt at `Paths.state() + '/install-receipt.json'` Zod-validates against `InstallReceiptZodSchema` → re-validate each recorded side-effect, print `"already initialized at <Paths.data()>"`, exit 0.
3. **XDG subtree creation** — `fs.mkdir({recursive: true})` of `Paths.config()`, `Paths.data()`, `Paths.state()`, `Paths.cache()`, plus the 8 subdirectories `Paths.docs()`, `Paths.inbox()`, `Paths.pending()`, `Paths.processed()`, `Paths.failed()`, `Paths.trash()`, `Paths.docsStore()`, `Paths.pilotTelemetry()`. ZERO new `Paths.*` getters per Constitution XIV.
4. **SQLite open + migrate + WAL checkpoint + sidecar unlink** — Open `Paths.indexDb()` via the substrate's `openIndexReadWrite` helper, run the SP-001..SP-006 migration set, then `PRAGMA wal_checkpoint(TRUNCATE)` + `fs.unlink` any `*.db-shm` / `*.db-wal` sidecars. On-disk install-exit footprint is exactly one file per NFR-010.
5. **Default `config.toml` write** — Zod-validated against `ConfigTomlZodSchema`; preserves operator edits on re-install (idempotent).
6. **Curated taxonomy seed** — Load `packages/cli/src/install-resources/taxonomy-seed.json` (≥ 25, ≤ 50 terms); Zod-validate; acquire `Paths.drainLock()`; bulk `INSERT OR IGNORE` in a single `BEGIN IMMEDIATE → COMMIT` transaction; release lock. Idempotent on re-install (Constitution X).
7. **MCP-client config mutate** — Read `~/.claude.json` (or `--mcp-client-config <path>`); JSON-parse; Zod-validate permissively; set or update `mcpServers.corpus = {command: <abs-corpus-path>, args: ['mcp']}`; write back atomically via `withTempDir` (Constitution VIII). On malformed JSON, exit non-zero BEFORE any other side-effect.
8. **OS firewall provision** — Capture `os.userInfo().uid`; provision UID-scoped rule via `runTool('pfctl', [...])` (macOS) or `runTool('iptables', [...])` (Linux) per ADR-013 + ADR-001 path (b). Idempotent (existing-rule detection). Reverse-command recorded in install-receipt.
9. **Optional auto-start unit** — Only when `--enable-autostart` is provided (default OFF per Decision E in research.md). Writes `~/.config/systemd/user/corpus.service` (Linux) or `~/Library/LaunchAgents/io.llm-corpus.daemon.plist` (macOS); invokes `runTool('systemctl', ['--user', 'enable', '--now', 'corpus.service'])` or `runTool('launchctl', ['load', '<plist>'])`. Reverse-command recorded.
10. **Install-receipt write** — Assemble the receipt from accumulated side-effects; Zod-validate against `InstallReceiptZodSchema`; write atomically via `withTempDir` to `Paths.state() + '/install-receipt.json'`.
11. **Next-step output** — Print operator next-step instructions to stdout (inbox path + sample Claude Code prompt).

**Optional 12th smoke step** — Only when `--smoke` is provided. Spawns `corpus daemon start`, drops `packages/cli/fixtures/first-run-seed.md` into `Paths.inbox()`, polls `Paths.telemetry()` for `edges-build.completed` (30-second sub-budget), spawns `corpus mcp` child, invokes `corpus.find` via real MCP-stdio, asserts ≥ 1 SearchHit, tears down daemon. The smoke is EXEMPT from the 90-second non-smoke budget and has its own 30-second budget. Failure does NOT undo the install (steps 1-11 already succeeded).

**90-second AbortController budget** — `setTimeout(() => controller.abort('install_budget_exceeded'), 90000)` + `clearTimeout(handle)` on step-11 completion. NEVER `Promise.race(setTimeout)` (Constitution VII forbidden pattern). SIGINT propagates through the master AbortSignal and unwinds via the install-rollback flow.

**Install-rollback (on step-N failure where N ∈ [3..10])**:

- Walk the partial-receipt's reverse-list (recorded side-effects from steps 1..N-1) in reverse order.
- For each, invoke the recorded reverse-command via `runTool()` (firewall, auto-start) or `fs.rm` / `fs.unlink` (XDG paths, MCP-client config entry, seed rows).
- The unwind itself is idempotent (Constitution X).
- After unwind, DELETE the partial-receipt (NOT preserve with `uninstalled: true` — that's the post-uninstall semantic).
- Exit non-zero with `install.step_failed` telemetry naming the failing step.

**Receipt-driven uninstall reverse contract**:

1. **Preflight** — Read `Paths.state() + '/install-receipt.json'`; Zod-validate. Missing or malformed → non-zero exit + `uninstall.preflight_failed` event + ZERO destructive operations. Platform mismatch (receipt's `os` ≠ current `os.platform()`) → non-zero exit + clear-remediation message.
2. **Active daemon detect** — If `Paths.state() + '/daemon.pid'` exists and the PID is live, invoke `runTool('corpus', ['daemon', 'stop'])` and wait the Constitution VII 2-second shutdown budget. On timeout, exit non-zero with operator-driven kill remediation.
3. **Reverse MCP-client config** — For each entry in `receipt.mcp_client_configs[]`, read the file, delete `mcpServers.corpus`, preserve other entries, write back atomically via `withTempDir`.
4. **Reverse firewall rule** — For each entry in `receipt.firewall_rules[]`, invoke `runTool(entry.reverse_command.cmd, entry.reverse_command.args)`. Post-invocation, query the firewall to confirm reversal (`pfctl -sr | grep corpus-uid` returns empty on macOS; `iptables -L OUTPUT -n | grep <uid>` returns empty on Linux).
5. **Reverse auto-start unit** (if recorded) — For each entry in `receipt.auto_start_units[]`, invoke `runTool(entry.reverse_command.cmd, entry.reverse_command.args)` + `fs.unlink(entry.unit_path)`.
6. **Branch on `--purge`**:
   - **Without `--purge`**: Set `receipt.uninstalled = true`, `receipt.uninstalled_at = <now>`; write back atomically. XDG subtree preserved per TR-002.
   - **With `--purge`**: `fs.rm({recursive: true})` for each of `Paths.config() / Paths.data() / Paths.state() / Paths.cache()` scoped to `llm-corpus`. Delete the receipt (already gone if `Paths.state()` was purged).
7. **Post-uninstall verification summary** — Print to stdout the filesystem diff + firewall query result + MCP-client config diff. Operator can paste into a bug report.
8. **Exit 0** with `uninstall.completed` event.

**Idempotent uninstall resumption** — SIGINT mid-flow records the partial-uninstall state in the receipt. Re-running `corpus uninstall` consults the reverse-list incrementally; already-reversed side-effects are skipped (Constitution X). The uninstall is itself idempotent.

**Install-receipt Zod schema** (`InstallReceiptZodSchema` in `packages/contracts/src/install-schemas.ts`) — see data-model.md Entity 1 for the full field-by-field shape.

## Consequences

**Positive**:

- Operator runs one command (`npx @llm-corpus/cli init`) and has a working corpus in ≤ 90 seconds — closes RM-008 vs Letta / Mem0.
- Uninstall is deterministic + verifiable (filesystem diff + firewall query + MCP-client diff) — closes TR-002 + SP-007 exit criteria.
- The receipt-driven path means operators don't need to know the install internals to reverse-engineer cleanup.
- The 90-second budget is an enforced ceiling (Constitution XVI honesty), not a marketing target.
- The 12-step install pipeline is a stable contract for SP-007+ evolution.

**Negative**:

- Rollback complexity: on step-N failure, the install-rollback flow must reverse N-1 side-effects in correct order. Any rollback bug leaves the operator with debris. Mitigation: `tests/unit/install-rollback.test.ts` exhaustively tests every (failing-step, N) pair.
- Receipt-versioning lock-in: `schema_version: 1` commits SP-007 to a stable shape. Future receipt-schema changes require `schema_version: 2` + migration.
- Lost receipt blocks uninstall: per spec.md Out of Scope, manual fallback is documented but a `corpus uninstall --force` flag is future-horizon.
- The MCP-client config path (`~/.claude.json`) is the only path outside `Paths.*`; explicitly recorded in receipt to honor Constitution XIV.

**Neutral**:

- The 11-step pipeline is sequential (no internal parallelism). The 90-second budget accommodates this; parallelism is future-horizon if step-budgets become tight.
- The `--smoke` step's 30-second sub-budget is Ollama-dependent and exempt from the 90-second ceiling; this is honestly documented.

## Alternatives considered

- **One-shot `npx <pkg> install` script that wraps all 11 steps + smoke**: REJECTED. The 11-step pipeline is what the CLI binary's `init` subcommand does; the `npx` wrapper just invokes the binary. There's no separate script.
- **No install-receipt; uninstall infers side-effects from the filesystem**: REJECTED. Inference is fragile (operator may have edited files; the substrate may have evolved). Receipt-driven uninstall is deterministic.
- **Receipt as a SQL table in the index**: REJECTED. The receipt must survive `--purge` of the index until the explicit deletion at step 6 of uninstall (with `--purge`). A separate JSON file at `Paths.state()` is the right scope.
- **Atomic install (whole pipeline succeeds-or-fails-cleanly)**: REJECTED. The pipeline has 11 sequential steps with external side-effects (firewall, auto-start unit). True atomicity would require a 2-phase-commit-like protocol over OS-level resources, which doesn't exist. The rollback flow is the practical approximation.
- **Install + uninstall as separate npm packages**: REJECTED. Single CLI binary with `init` + `uninstall` subcommands is the simpler distribution model + matches the `npx @llm-corpus/cli init` UX commitment.

## Compliance / verification

- **Tests**: `tests/integration/install-end-to-end.test.ts` (full pipeline against fixture HOME); `tests/integration/install-rerun-idempotent.test.ts` (idempotency); `tests/integration/uninstall-end-to-end.test.ts` (reverse + filesystem diff); `tests/unit/install-receipt.test.ts` (Zod round-trip); `tests/unit/install-rollback.test.ts` (every (failing-step, N) pair); `tests/unit/install-budget-enforcement.test.ts` (90-second ceiling); `tests/unit/uninstall-idempotent-resume.test.ts` (SIGINT mid-flow + resume); `packages/cli/test/smoke-e2e.test.ts` (C-046 end-to-end).
- **Telemetry**: 9 install + uninstall + receipt event classes (install.preflight_failed, install.step_failed, install.completed, install.smoke_*, uninstall.*).
- **Trigger to revisit**: any future requirement for a `--force` uninstall (no-receipt path), or a receipt-schema v2 (additive fields), or a Windows install path, opens an ADR-012 superseder.
