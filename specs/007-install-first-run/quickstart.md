# SP-007 Quickstart (operator walkthrough)

**Feature**: 007-install-first-run
**Date**: 2026-05-16

This document walks the operator through the four SP-007 deliverables —
`corpus init`, `corpus uninstall`, `corpus taxonomy promote`, and the
`corpus failures` triage CLI — on a clean Linux or macOS workstation with
Node ≥ 18 and Ollama running.

---

## Prereq verification log — T001 (2026-05-15)

Captured on pai-node01 (Fedora 43, Linux 6.19.13-200.fc43.x86_64) prior to
Phase 2 contract-surface work.

| Prereq | Resolves to | Verified |
| --- | --- | --- |
| `command -v iptables` | `/usr/bin/iptables` | yes |
| `command -v systemctl` | `/usr/bin/systemctl` | yes |
| `command -v sudo` | `/usr/bin/sudo` | yes |
| `node --version` | `v22.22.0` (build toolchain ≥ 20; FR-INSTALL-003 operator floor is ≥ 18) | yes |
| SP-001..SP-006 baseline on `main` | head at `0376dec` (SP-007 spec package); SP-006 retro at `c106532`; SP-006 squash `5237916` confirmed via `git log --oneline` | yes |
| `Paths.config`, `Paths.configFile`, `Paths.data`, `Paths.state`, `Paths.cache`, `Paths.docs`, `Paths.inbox`, `Paths.pending`, `Paths.processed`, `Paths.failed`, `Paths.trash`, `Paths.docsStore`, `Paths.pilotTelemetry`, `Paths.indexDb`, `Paths.drainLock`, `Paths.telemetry` | All exported from `packages/contracts/src/paths.ts` | yes |
| `runTool` exported from SP-001 helper | `packages/contracts/src/run-tool.ts` | yes |
| `withTempDir` exported from SP-001 helper | `packages/contracts/src/with-temp-dir.ts` | yes |
| `openIndexReadWrite` exported from SP-001 helper | `packages/storage/src/document-writer.ts` | yes |
| `gh auth status` exit 0 | Logged in to github.com as `sleepytimeshon` (keyring); SSH | yes |
| `pfctl` available | n/a — macOS-only binary; T001 only requires Linux baseline here | n/a (Linux host) |
| `launchctl` available | n/a — macOS-only binary | n/a (Linux host) |

### Ollama gating for C-046 smoke

The C-046 end-to-end smoke harness (Phase 3 T050 + Phase 9 T091) is gated on
the `OLLAMA_RUNNING=1` environment variable per FR-INSTALL-013 +
FR-INSTALL-024. When unset, the test conditionally skips via
`it.skipIf(!ollamaReachable)` so CI without Ollama still passes; on dev
machines with Ollama listening on `127.0.0.1:11434` it runs unconditionally.
Operators reproducing the walkthrough locally must `ollama pull qwen3:8b`
and `ollama pull nomic-embed-text` before the smoke step.

---

## Walkthrough 1 — One-command install on a clean machine

**Goal**: Demonstrate that `corpus init` provisions a working substrate in
under 90 seconds on a clean Linux or macOS workstation.

### Step 1: Install

```bash
# Once the package is published to npm:
npx @llm-corpus/cli init

# Or from a local checkout:
node packages/cli/dist/index.js init
```

Observe stdout: each of the 11 steps emits a one-line status as it
completes (preflight → idempotency check → XDG bringup → SQLite singlefile →
config.toml → taxonomy seed → MCP-client config → firewall provision →
auto-start unit → install-receipt → next-step output). The whole pipeline
is wrapped in a 90-second AbortController budget per FR-INSTALL-002.

### Step 2: Verify XDG bringup

```bash
ls -d ~/.config/llm-corpus ~/.local/share/llm-corpus ~/.local/state/llm-corpus ~/.cache/llm-corpus
```

All four XDG bases exist. The 12 derived paths under those bases
(`docs/`, `docs/inbox`, `docs/pending`, `docs/processed`, `docs/failed`,
`docs/trash`, `docs/store`, etc.) are listed in
`packages/contracts/src/paths.ts`.

### Step 3: Verify the SQLite index is single-file

```bash
ls -la ~/.local/share/llm-corpus/index.db*
```

Expect exactly one `.db` file. No `.db-wal` or `.db-shm` sidecars
(FR-INSTALL-006 / NFR-010 — `PRAGMA wal_checkpoint(TRUNCATE)` runs at
install exit).

### Step 4: Verify the curated taxonomy seed

```bash
sqlite3 ~/.local/share/llm-corpus/index.db \
  "SELECT axis, COUNT(*) FROM taxonomy_terms WHERE state='established' GROUP BY axis;"
```

Expect ≥ 25 established rows across the four axes (`domain`, `type`,
`tag`, `source_type`) — the curated seed shipped in
`packages/cli/src/install-resources/taxonomy-seed.json`.

### Step 5: Verify the MCP-client registration

```bash
jq '.mcpServers.corpus' ~/.claude.json
```

Expect the entry `{"command": "<abs-corpus-path>", "args": ["mcp"]}`. Any
prior `mcpServers.*` entries are preserved (FR-INSTALL-009).

### Step 6: Verify the OS firewall rule

```bash
# Linux:
sudo iptables -L OUTPUT -n -v | grep llm-corpus

# macOS:
sudo pfctl -a corpus -sr
```

Expect a UID-scoped rule rejecting all non-loopback egress for the corpus
UID (ADR-013 / Constitution I / Principle IV).

### Step 7: Inspect the install-receipt

```bash
jq . ~/.local/state/llm-corpus/install-receipt.json
```

Receipt fields per data-model.md Entity 1: `schema_version: 1`,
`installed_via`, `installed_at`, `created_paths[]`, `mcp_client_configs[]`,
`firewall_rules[]` (each with a `reverse_command`), `auto_start_units[]`,
`seeded_taxonomy_terms[]`, `config_toml_written: bool`,
`os: 'linux'|'macos'`, `node_version`, `package_version`.

---

## Walkthrough 2 — `corpus init --smoke` (C-046 end-to-end smoke)

**Goal**: Confirm the smoke harness drops a fixture document, observes
ingest through edges-build, then spawns a real `corpus mcp` server and
asserts `corpus.find` returns ≥ 1 SearchHit pointing at the seed.

```bash
OLLAMA_RUNNING=1 corpus init --smoke
```

Observe the optional 12th step in the install pipeline. It carries its
own 30-second sub-budget per FR-INSTALL-013. Successful smoke emits the
`install.smoke_started` → `install.smoke_completed` telemetry pair. On
failure the smoke does NOT roll back the install (steps 1-11 already
succeeded); the operator can re-run `corpus init --smoke` after fixing
the underlying Ollama / model issue.

---

## Walkthrough 3 — Vocabulary-violation triage round-trip (NFR-006)

**Goal**: Drive the canonical NFR-006 failure-lane CLI triage path end-to-end.

### Step 1: List the failure lane

```bash
corpus failures list
corpus failures list --stage=classify
corpus failures list --since=2026-05-10T00:00:00Z --limit=20
corpus failures list --json  # for piping
```

The CLI reads `Paths.failed()` directly (no MCP server spawn for a
read-only lookup). Output is a human-readable table by default, or JSON
with `--json`.

### Step 2: Show a specific sidecar

```bash
corpus failures show doc-12345678
```

Expect the full sidecar JSON: `doc_id`, `stage`, `error_code`,
`message`, `timestamp`, `retriable`, `sidecar_path`. For a
vocabulary-violation the `message` field names the missing term, e.g.,
`unknown domain term: climbing`.

### Step 3: Promote the missing taxonomy term

```bash
corpus taxonomy promote --axis=domain --term=climbing
```

The drain-lock at `Paths.drainLock()` is acquired non-blocking; on
contention the command emits `taxonomy.promote_lock_contention` and
exits non-zero with zero SQL writes. On success the term transitions
`proposed → established` in a single UPDATE transaction.

### Step 4: Re-enrich the rejected document

```bash
corpus reenrich doc-12345678
```

The SP-005 reenrich command drives the doc back through the classify
stage; with the term now established the doc passes through to the
embed/index/edges-build stages. The SP-006 recovery scanner removes the
sidecar on subsequent daemon restart.

---

## Walkthrough 4 — `corpus uninstall` (no `--purge`)

**Goal**: Verify receipt-driven reversal preserves XDG data while
removing every install side-effect.

```bash
corpus uninstall
```

The 4-step reverse pipeline runs sequentially per the recorded
`install-receipt.json`:

1. Reverse MCP-client config: `jq 'del(.mcpServers.corpus)' ~/.claude.json`
2. Reverse firewall rules: invoke each recorded `reverse_command` via
   `runTool()`.
3. Reverse auto-start unit (if recorded): `systemctl --user disable
   --now corpus.service` on Linux or `launchctl unload <plist>` on macOS;
   then `fs.unlink(unit_path)`.
4. Mark receipt `uninstalled: true` + `uninstalled_at: <now>`; XDG
   subtree preserved.

A paste-friendly verification summary prints to stdout:
- Filesystem diff (every `created_paths` row with present/absent status)
- Firewall query result (rule absent post-uninstall)
- MCP-client config diff (`mcpServers.corpus` absent)

---

## Walkthrough 5 — `corpus uninstall --purge`

**Goal**: Full removal — XDG subtree deleted + receipt removed.

```bash
corpus uninstall --purge
```

Steps 1-3 above; then `fs.rm(Paths.config(), {recursive: true})` × the
four XDG bases; then `fs.unlink(install-receipt.json)`.

Verify:

```bash
ls -d ~/.config/llm-corpus ~/.local/share/llm-corpus 2>&1
```

Expect "No such file or directory".

---

## Honest performance notes (Constitution XVI)

Per FR-INSTALL-002, `corpus init` MUST exit within 90 seconds end-to-end.
Per FR-INSTALL-013, `--smoke` adds an independent 30-second sub-budget.

**Empirical p95 measurement (T088-T091)**: live performance measurement
on pai-node01 is **deferred to the operator's first install**. Reason: the
SP-006 retrospective F-2 (classifier model `qwen3:8b` defaults; cold-load
on first request takes 30-60 s) makes the smoke harness sensitive to
whether the Ollama models are already loaded into memory. The 90-second
ceiling and 30-second smoke ceiling are AbortController-enforced, NOT
based on a measured median — they are HARD CEILINGS that fail-fast
rather than time-budget commitments.

The operator's first run of `corpus init` on a clean machine produces
the canonical p95. We document the result here once measured on the
operator side.

| Step | Budget | Measured p95 | Status |
| --- | --- | --- | --- |
| preflight | n/a | TBD | deferred |
| xdg_bringup | 2 s | TBD | deferred |
| sqlite_singlefile | 10 s | TBD | deferred |
| config_toml | n/a | TBD | deferred |
| taxonomy_seed | 1 s | TBD | deferred |
| mcp_client_config | 1 s | TBD | deferred |
| firewall_provision | 10 s | TBD | deferred |
| auto_start_unit | n/a | TBD | deferred |
| install_receipt | n/a | TBD | deferred |
| **install total** | **90 s** | **TBD** | **deferred** |
| smoke (optional) | 30 s | TBD | deferred (Ollama-gated) |

The deferral is honest, not aspirational. The AbortController ceilings
in `packages/pipeline/src/policies.ts` are the authoritative contract.

---

## Constitution Check 16/16

| Principle | Status |
| --- | --- |
| I — Local-only by default | Pass — ONE annotated `Principle I loopback exception` in `preflight.ts` for FR-INSTALL-003 Ollama-reachability GET against `127.0.0.1:11434`. |
| II — Substrate, not surface | Pass — SP-007 ships CLI surfaces (init/uninstall/taxonomy promote/failures), not substrate inversions. |
| III — Zero new MCP mutation surfaces | Pass — sp007-no-new-mcp-mutation-surfaces.test.ts asserts the five SP-002+SP-006 read-only resources + one `corpus.find` tool are preserved. |
| IV — UID-scoped firewall | Pass — ADR-013 / firewall-provisioner.ts. |
| V — Zod schema enforcement | Pass — 11 new install-schemas (T012) round-trip tested. |
| VI — Configured policy | Pass — 8 new policy fields (T015). |
| VII — No `Promise.race(setTimeout)` | Pass — sp007-eslint-no-promise-race-settimeout.test.ts + sp007-constitutional-grep.test.ts. |
| VIII — TDD | Pass — RED tests authored before GREEN implementations across Phase 2-6. |
| IX — ≤ 4096-byte telemetry payloads | Pass — install-telemetry-classes.test.ts. |
| X — Idempotent install | Pass — install-idempotency.test.ts + install-rerun-idempotent.test.ts. |
| XI — Library/CLI boundary | Pass — sp007-eslint-no-process-exit-in-libs.test.ts; only 4 CLI command entry points may `process.exit`. |
| XII — Subprocess hygiene (no shell strings) | Pass — sp007-eslint-no-shell-string-exec.test.ts; every external command via `runTool(cmd, args[])`. |
| XIII — Telemetry-on-every-catch | Pass — verified via SP-007 telemetry-classes test + per-helper unit coverage. |
| XIV — Paths from resolver | Pass — sp007-paths-from-resolver-only.test.ts + sp007-constitutional-grep.test.ts; ONE allowed `os.homedir()` exception for the MCP-client config path. |
| XV — Single-user / single-machine | Pass — install is per-UID; MCP-client config + firewall both UID-scoped. |
| XVI — Honest performance | Pass — performance ceilings are AbortController-enforced; p95 measurement honestly deferred to operator first install. |

**16/16 pass.** Two explicit DEFERRALS (FR-INSTALL-026 + FR-INSTALL-027 →
C-043 + C-044) recorded in `docs/SESSION_STATE.md` and in
RETROSPECTIVE.md.

