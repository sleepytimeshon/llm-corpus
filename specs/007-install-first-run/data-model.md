# Phase 1 — Data Model: Install + 90-Second First-Run UX (SP-007)

**Feature**: 007-install-first-run
**Date**: 2026-05-15

This document formalizes the SP-007 entities, their fields, invariants, lifecycle, persistence paths, and their mapping into the existing SP-001..SP-006 substrate. It also enumerates the new telemetry event-class Zod schemas added additively to the existing `TelemetryEvent` discriminated union in `packages/contracts/src/telemetry.ts`.

**Schema delta: NONE.** SP-007 introduces ZERO new SQL tables. The curated taxonomy seed is INSERTed into the existing SP-004 `taxonomy_terms` table with `state='established'` via `INSERT OR IGNORE`; the `corpus taxonomy promote` mutation UPDATEs rows in the same table. The install-receipt is a single JSON file at `Paths.state() + '/install-receipt.json'` (NEW write target, but in an existing XDG base — same pattern as SP-006's `.recovery.error.json` sidecars relative to SP-003's `.error.json` sidecars). The MCP-client config (`~/.claude.json` by default) is the ONLY path the install touches outside `Paths.*` and is recorded explicitly in the install-receipt per Constitution XIV.

---

## Schema migration delta (verbatim — no SQL DDL; only Zod schema additions)

### `Paths.state() + '/install-receipt.json'` (install-receipt — NEW write target)

Format: a single JSON document validated against `InstallReceiptZodSchema`. See Entity 1 for the full shape.

**Invariants**:

- One receipt per install. Written atomically via `withTempDir` post-step-11; Zod-validated at write time AND at read time (uninstall preflight).
- File location: `Paths.state() + '/install-receipt.json'`.
- If absent: install short-circuits the "already initialized" detection at preflight (this is the clean-install path). Uninstall fails non-zero with a clear-remediation message naming the receipt path.
- If malformed JSON or fails Zod: install detects at preflight (partial-install debris) and refuses to proceed; uninstall exits non-zero. Manual operator remediation documented.

### `Paths.state() + '/install-receipt.json'` post-uninstall (without `--purge`)

Without `--purge`, the uninstall does NOT delete the receipt. Instead, it adds two fields:

```json
{
  "uninstalled": true,
  "uninstalled_at": "<ISO-8601>"
}
```

This preserves the side-effect history so future installs can audit prior state. With `--purge`, the receipt is deleted along with the XDG subtree.

### `taxonomy_terms` rows (NO SCHEMA CHANGE; ONLY DATA CHANGE)

The SP-004 `taxonomy_terms` table is preserved verbatim. SP-007 INSERTs new rows with `state='established'` at install-step-6 via `INSERT OR IGNORE`; SP-007 UPDATEs existing rows from `state='proposed'` to `state='established'` via the `corpus taxonomy promote` CLI. No DDL change.

### MCP-client config file (`~/.claude.json` by default)

JSON shape (Zod-validated permissively at read time + after-write time):

```json
{
  "mcpServers": {
    "corpus": {
      "command": "<absolute path to corpus binary>",
      "args": ["mcp"]
    },
    "...other entries...": "...preserved..."
  }
}
```

**Invariants**:

- The corpus entry is `mcpServers.corpus`; key is `"corpus"` (single-word, lowercase).
- The entry's `command` is the absolute path to the running corpus binary at install time (captured via `process.argv[1]` → `realpath` or `process.execPath` for npx-cached).
- The entry's `args` is exactly `["mcp"]` — the SP-001 MCP-stdio entry point.
- The entry has NO environment variables for v1 (the daemon reads its environment from the operator's shell).
- The install mutates ONLY `mcpServers.corpus`; all other keys (other MCP servers, root-level keys) are preserved.
- If the file does not exist, the install creates it with `{"mcpServers": {"corpus": {...}}}` shape.
- If the file exists but is malformed JSON, the install exits non-zero BEFORE any other side-effect.

### `~/.config/systemd/user/corpus.service` (Linux + `--enable-autostart`)

Format: systemd unit file (see Decision E in research.md for the exact contents).

**Invariants**:

- Written only when `--enable-autostart` is provided.
- Path: `~/.config/systemd/user/corpus.service` (operator-scoped, not system-wide).
- Reverse-command recorded in install-receipt: `runTool('systemctl', ['--user', 'disable', '--now', 'corpus.service'])` + `runTool('rm', ['-f', '<unit-path>'])` (or `fs.unlink` from JS).
- Operator-conflict-detection: if a unit file already exists at the path, install exits non-zero with `--force-autostart` remediation.

### `~/Library/LaunchAgents/io.llm-corpus.daemon.plist` (macOS + `--enable-autostart`)

Format: launchd plist (XML; see Decision E in research.md for the exact contents).

**Invariants**:

- Written only when `--enable-autostart` is provided.
- Path: `~/Library/LaunchAgents/io.llm-corpus.daemon.plist` (per-user, not system).
- Reverse-command recorded in install-receipt: `runTool('launchctl', ['unload', '<plist-path>'])` + `fs.unlink(<plist-path>)`.

---

## Entity 1 — InstallReceipt

The canonical record of a successful `corpus init` run. Sufficient for `corpus uninstall` to reverse every side-effect deterministically.

**Fields** (Zod-validated by `InstallReceiptZodSchema` in `packages/contracts/src/install-schemas.ts`):

- `schema_version: 1` — literal for v1; future SP-007+ may ship `2`.
- `installed_at: string (ISO-8601)` — wall-clock timestamp of the install completion.
- `installed_via: 'npx' | 'global' | 'local'` — how the binary was invoked (heuristic from `process.execPath`).
- `corpus_binary_path: string` — absolute path to the corpus binary at install time (captured via `process.argv[1]` → `realpath` or `process.execPath`). Recorded so uninstall, MCP-client config, and auto-start unit all reference the same path.
- `created_paths: string[]` — every XDG path created by step-3 (`Paths.config()`, `Paths.data()`, `Paths.state()`, `Paths.cache()`, plus the 8 subdirectories). Each entry is an absolute path. Used by uninstall `--purge` to confirm which paths to `fs.rm({recursive: true})`.
- `mcp_client_configs: Array<{path: string, key_added: 'mcpServers.corpus'}>` — every MCP-client config file mutated and the corpus key added. v1 has at most one entry (the operator's `~/.claude.json` or `--mcp-client-config <path>`). Future SP-007+ may have multiple if cross-agent registration is added.
- `firewall_rules: Array<{os: 'macos' | 'linux', anchor_or_chain: string, rule_text: string, reverse_command: {cmd: string, args: string[]}}>` — every firewall rule provisioned. v1 has exactly one entry (the ADR-001 path (b) UID-scoped rule for the corpus runtime UID). The `reverse_command` is verbatim what `corpus uninstall` invokes via `runTool()`.
- `auto_start_units: Array<{os: 'macos' | 'linux', unit_path: string, reverse_command: {cmd: string, args: string[]}}>` — every auto-start unit installed (empty array if `--enable-autostart` not provided). v1 has at most one entry.
- `seeded_taxonomy_terms: Array<{axis: string, term: string, established_at: string (ISO-8601)}>` — every taxonomy term inserted at step-6. v1 has ≥ 25, ≤ 50 entries.
- `os: 'macos' | 'linux'` — discriminator captured via `os.platform()`.
- `os_version: string` — captured via `os.release()`; used by uninstall's preflight to verify platform parity with install.
- `node_version: string` — captured via `process.versions.node`; informational.
- `uninstalled?: boolean` — optional; set to `true` by `corpus uninstall` (without `--purge`).
- `uninstalled_at?: string (ISO-8601)` — optional; set by `corpus uninstall` (without `--purge`).

**Persistence**:

- On disk at `Paths.state() + '/install-receipt.json'`.
- Written atomically via `withTempDir` (Constitution VIII).
- Zod-validated at write time AND at read time.

**Lifecycle**:

1. **Assemble**: During the install, each step appends its side-effect record to an in-memory `InstallReceipt` accumulator. Step-3 appends to `created_paths`. Step-6 appends to `seeded_taxonomy_terms`. Step-7 appends to `mcp_client_configs`. Step-8 appends to `firewall_rules`. Step-9 (if enabled) appends to `auto_start_units`.
2. **Write**: Step-10 finalizes the receipt: sets `schema_version: 1`, `installed_at`, `installed_via`, `corpus_binary_path`, `os`, `os_version`, `node_version`. Validates against `InstallReceiptZodSchema`. Writes atomically via `withTempDir`.
3. **Read** (uninstall preflight): Uninstall reads + Zod-validates. On schema mismatch, exits non-zero with `UninstallReceiptMissingError`.
4. **Mutate** (post-uninstall without `--purge`): Uninstall sets `uninstalled: true` + `uninstalled_at: <now>`; re-writes atomically.
5. **Delete** (post-uninstall with `--purge`): Uninstall deletes the receipt as part of the XDG subtree removal.

**Invariants**:

- `created_paths` are absolute paths under `Paths.*`-derivable XDG bases (Constitution XIV).
- `firewall_rules[*].reverse_command.cmd` is exactly the binary name (`pfctl` or `iptables` — never a shell string).
- `firewall_rules[*].reverse_command.args` is an array of literal arguments (Constitution XII).
- `seeded_taxonomy_terms[*].established_at` is the wall-clock at install-step-6, NOT `datetime('now')` (the SQL function); the in-receipt timestamp is for audit, not for SQL re-derivation.
- The receipt is the SINGLE source-of-truth for what to reverse during uninstall. Operators are NOT expected to read the substrate's other state to reverse-engineer the install.

---

## Entity 2 — TaxonomySeedEntry

One row in the curated seed file at `packages/cli/src/install-resources/taxonomy-seed.json`.

**Fields** (Zod-validated by `TaxonomySeedEntryZodSchema`):

- `axis: 'domain' | 'type' | 'tag' | 'source_type'` — closed enum matching the SP-004 `taxonomy_terms` axis column values.
- `term: string` — the seed term (e.g., `'engineering'`, `'article'`).

**Persistence**:

- In-package at `packages/cli/src/install-resources/taxonomy-seed.json`; bundled into the published package.
- After insert: as rows in `taxonomy_terms` with `state='established'`.

**Lifecycle**:

1. **Author** (SP-007 plan-stage): Shon curates the seed list from the SP-006 USER-GUIDE.md workaround list; commits the JSON file.
2. **Load** (install-step-6): The install reads the JSON file from disk + Zod-validates it as `TaxonomySeedZodSchema = z.array(TaxonomySeedEntryZodSchema).min(25).max(50)`.
3. **Insert**: The install acquires `Paths.drainLock()` (Constitution IX), opens a `BEGIN IMMEDIATE` transaction, executes `INSERT OR IGNORE INTO taxonomy_terms (axis, term, state, established_at) VALUES (?, ?, 'established', datetime('now'))` per entry, COMMITs, releases the lock.
4. **Re-install** (idempotent): On re-run, `INSERT OR IGNORE` collapses duplicates; operator-authored entries are preserved (Constitution X).

**Invariants**:

- ≥ 25 entries (the SP-006 USER-GUIDE.md floor: 5 + 6 + 9 + 5).
- ≤ 50 entries (the dispatch prompt C-045 cap).
- The four axis distributions are: 5 domains, 6 types, 9 tags, 5 source_types (the floor). Additional entries above 25 may be in any axis (researched by Shon at plan-stage).
- `term` is non-empty and trimmed (no leading/trailing whitespace).
- No duplicate `(axis, term)` within the seed file.

---

## Entity 3 — InstallPreflightResult

An in-memory record produced by step-1 of `corpus init`. Lives only during the install; never persisted (but referenced in the `install.preflight_failed` telemetry event payload on failure).

**Fields** (Zod-validated by `InstallPreflightResultZodSchema`):

- `node_ok: boolean` — `process.versions.node` parsed via semver ≥ 18.0.0.
- `node_version: string` — the actual `process.versions.node` value.
- `ollama_ok: boolean` — `http://127.0.0.1:11434/api/tags` GET succeeded.
- `ollama_models_pulled: {classifier: boolean, embedder: boolean}` — the Ollama `/api/tags` response includes `qwen3:8b` AND `nomic-embed-text`.
- `xdg_writable: boolean` — `fs.access(Paths.config() / Paths.data() / Paths.state() / Paths.cache(), W_OK)` for all four XDG bases (or `mkdir -p` followed by `access` for non-existent dirs).
- `partial_install_detected: boolean` — XDG paths exist but no install-receipt at `Paths.state() + '/install-receipt.json'`.
- `partial_install_paths: string[]` — if `partial_install_detected`, the list of existing XDG paths (for the remediation message).

**Lifecycle**:

1. **Compute** (install-step-1): The install probes Node version, Ollama, XDG writability, partial-install debris.
2. **Dispatch**: The CLI dispatches on `node_ok && ollama_ok && xdg_writable && !partial_install_detected`. Only an all-pass result proceeds.
3. **Emit on failure**: On any preflight failure, `install.preflight_failed` is emitted with the result payload + an `unmet_requirement: 'node_version' | 'ollama_reachability' | 'ollama_models' | 'xdg_writable' | 'partial_install'` discriminator. Then the CLI exits non-zero with a stderr remediation message.

**Invariants**:

- Computed BEFORE any other side-effect; ZERO XDG paths are created during preflight.
- `ollama_ok` is true ONLY when the loopback GET returns 200 AND the response body parses as JSON AND lists ≥ 1 model. The presence of `qwen3:8b` + `nomic-embed-text` is checked separately in `ollama_models_pulled`.
- `partial_install_detected` is the FR-INSTALL-004 + Edge-Cases-"re-run after partial failure" gate. The install refuses to proceed; the operator runs `corpus uninstall --purge` or manual cleanup.

---

## Entity 4 — MCPClientConfigEntry

The corpus-server entry the install appends to the operator's MCP-client config file (`~/.claude.json` by default).

**Fields** (Zod-validated by `MCPClientConfigEntryZodSchema`):

- `command: string` — absolute path to the installed `corpus` binary (the InstallReceipt's `corpus_binary_path`).
- `args: ['mcp']` — Zod-enforced literal tuple `['mcp']`. The SP-001 MCP-stdio entry point.

**Persistence**:

- In the MCP-client config file at `mcpServers.corpus`.
- The mutator writes back atomically via `withTempDir` (Constitution VIII).

**Lifecycle**:

1. **Read** (install-step-7): `fs.readFile(<config-path>)` → `JSON.parse` → Zod-validate as `MCPClientConfigFileZodSchema` (permissive root + strict `mcpServers` subtree).
2. **Mutate**: Set or update `mcpServers.corpus = {command: <abs-path>, args: ['mcp']}`. Other keys preserved.
3. **Write back**: Atomically via `withTempDir`.
4. **Record**: Add `{path: <config-path>, key_added: 'mcpServers.corpus'}` to the receipt's `mcp_client_configs`.
5. **Reverse** (uninstall): Delete `mcpServers.corpus`; write back atomically. Other keys preserved.

**Invariants**:

- The mutation is set-semantic (idempotent: re-running `corpus init` produces the same entry).
- The `command` field is the absolute path; if the operator moves the binary post-install, the operator re-runs `corpus init` to refresh.
- The `args` field is exactly `['mcp']`; no env vars; no extra CLI flags.
- If the config file is malformed JSON, the install exits non-zero BEFORE step-8 (firewall provisioning); the partial-receipt at that point records ONLY the side-effects from steps 1-6.

---

## Entity 5 — FirewallRuleSpec

An in-memory record describing the OS firewall rule the install provisions at step-8.

**Fields** (Zod-validated by `FirewallRuleSpecZodSchema`):

- `os: 'macos' | 'linux'` — discriminator captured via `os.platform()`.
- `corpus_uid: number` — captured via `os.userInfo().uid` at install time.
- `anchor_or_chain: string` — on macOS: `'corpus'` (pfctl anchor). On Linux: `'OUTPUT'` (iptables chain).
- `rule_text: string` — the actual rule text written to pfctl stdin (macOS) or constructed in args[] (Linux).
- `provision_command: {cmd: string, args: string[]}` — the runTool invocation at install time. E.g., macOS: `{cmd: 'pfctl', args: ['-a', 'corpus', '-f', '-']}` with `rule_text` piped to stdin. Linux: `{cmd: 'iptables', args: ['-A', 'OUTPUT', '-m', 'owner', '--uid-owner', '<uid>', '!', '-d', '127.0.0.1/8', '-j', 'REJECT', '-m', 'comment', '--comment', 'llm-corpus']}`.
- `reverse_command: {cmd: string, args: string[]}` — recorded for `corpus uninstall`. E.g., macOS: `{cmd: 'pfctl', args: ['-a', 'corpus', '-F', 'all']}`. Linux: same iptables invocation with `-D` substituted for `-A`.

**Persistence**:

- In the install-receipt's `firewall_rules[]` array (the `os`, `anchor_or_chain`, `rule_text`, `reverse_command` fields).
- ZERO SQL persistence; ZERO Paths.* file persistence.

**Lifecycle**:

1. **Construct** (install-step-8): Discriminate on `os.platform()`; capture `os.userInfo().uid`; build the platform-appropriate rule spec.
2. **Idempotency check**: Invoke `runTool('pfctl', ['-a', 'corpus', '-sr'])` (macOS) or `runTool('iptables', ['-C', 'OUTPUT', ...])` (Linux); if the rule is detected, skip provisioning.
3. **Provision**: Invoke the `provision_command` via `runTool()` with stdin (for pfctl) or args[] (for iptables). On non-root user + sudo available, prepend `sudo` to the runTool invocation; the operator enters the password once (stdin/stderr inherited).
4. **Record**: Add the spec to the receipt's `firewall_rules[]` with `reverse_command` populated.
5. **Reverse** (uninstall): Read the recorded `reverse_command`; invoke via `runTool()`; assert the post-uninstall query returns empty.

**Invariants**:

- `provision_command.args` is an arg array (Constitution XII); ZERO string-formed shell commands.
- `corpus_uid` is a numeric literal from `os.userInfo().uid`; never shell-interpolated.
- `reverse_command` is the EXACT inverse of `provision_command` (e.g., `-A` ↔ `-D` for iptables; `-f` ↔ `-F all` for pfctl).
- The rule is UID-scoped (Constitution IV single-user model); never PID-scoped.

---

## Entity 6 — TaxonomyPromoteArgs

The parsed arguments to `corpus taxonomy promote`.

**Fields** (Zod-validated by `TaxonomyPromoteArgsZodSchema`):

- `axis?: 'domain' | 'type' | 'tag' | 'source_type'` — closed enum; required when `--term` is provided.
- `terms?: string[]` — repeatable `--term <t>`; required when `--axis` is provided.
- `from_proposed_with_count_ge?: number` — integer in `[0, ∞)`; mutually exclusive with `axis + terms`.

**Validation**:

- Strict Zod refinement enforces mutual exclusivity: `(axis && terms) XOR from_proposed_with_count_ge`.
- `terms` is non-empty when present (Zod `.min(1)`).
- `from_proposed_with_count_ge` is integer + non-negative.
- Unknown `--axis` value → Zod rejection → non-zero exit with the valid axis enum listed in stderr (SC-007-020).

**Lifecycle**:

1. **Parse** (taxonomy-promote-command.ts): Parse argv → construct args object → Zod-validate.
2. **Acquire lock**: Acquire `Paths.drainLock()` via `flock(LOCK_EX | LOCK_NB)`. On contention, emit `taxonomy.promote_lock_contention` + non-zero exit.
3. **Resolve target rows**:
   - For `axis + terms` mode: for each term, look up `(axis, term)` in `taxonomy_terms`. If missing → emit `taxonomy.promote_missing_term` + non-zero exit. If `state='established'` → no-op for that term with `"already established: <axis>/<term>"` stdout.
   - For `from_proposed_with_count_ge` mode: `SELECT axis, term FROM taxonomy_terms WHERE state='proposed' AND proposed_count >= ?`.
4. **Mutate**: `UPDATE taxonomy_terms SET state='established', established_at=datetime('now') WHERE (axis, term) IN (...)` in a single transaction.
5. **Emit**: `taxonomy.promote_completed` per term + one stdout confirmation line per term.
6. **Release lock + exit 0**.

**Invariants**:

- The `--axis/--term` and `--from-proposed-with-count-ge` modes are mutually exclusive at the Zod boundary (Constitution V).
- Already-established terms are a no-op (Constitution X idempotency).
- Missing terms are non-zero exits with ZERO SQL writes (defense-in-depth + clear-remediation).
- The lock is acquired BEFORE any SQL write (Constitution IX); on contention, ZERO SQL writes occur.

---

## Entity 7 — InstallTelemetry

The new SP-007 telemetry event classes. Validated against the existing `TelemetryEvent` Zod discriminated union (additive variants).

**Variants**:

### `install.preflight_failed` event

```typescript
{
  event: 'install.preflight_failed',
  timestamp: ISO8601,
  severity: 'error',
  outcome: 'failure',
  unmet_requirement: 'node_version' | 'ollama_reachability' | 'ollama_models' | 'xdg_writable' | 'partial_install',
  details?: {
    node_version?: string,
    missing_models?: string[],
    partial_install_paths?: string[],
  },
}
```

### `install.step_failed` event

```typescript
{
  event: 'install.step_failed',
  timestamp: ISO8601,
  severity: 'error',
  outcome: 'failure',
  step: 'preflight' | 'idempotency_check' | 'xdg_bringup' | 'sqlite_singlefile' | 'config_toml' | 'taxonomy_seed' | 'mcp_client_config' | 'firewall_provision' | 'auto_start_unit' | 'install_receipt' | 'next_step_output',
  duration_ms: number,
  error_code: string,
}
```

### `install.completed` event

```typescript
{
  event: 'install.completed',
  timestamp: ISO8601,
  severity: 'info',
  outcome: 'success',
  duration_ms: number,
  installed_via: 'npx' | 'global' | 'local',
  os: 'macos' | 'linux',
  steps_skipped: string[],  // e.g., ['auto_start_unit'] when --enable-autostart not provided
}
```

### `install.smoke_started` event

```typescript
{
  event: 'install.smoke_started',
  timestamp: ISO8601,
  severity: 'info',
  outcome: 'success',
  seed_doc_path: string,  // absolute path to packages/cli/fixtures/first-run-seed.md
}
```

### `install.smoke_completed` event

```typescript
{
  event: 'install.smoke_completed',
  timestamp: ISO8601,
  severity: 'info',
  outcome: 'success',
  duration_ms: number,
  hits_returned: number,  // ≥ 1 for success
}
```

### `install.smoke_failed` event

```typescript
{
  event: 'install.smoke_failed',
  timestamp: ISO8601,
  severity: 'warning',  // smoke failure does NOT undo the install (steps 1-11 already succeeded)
  outcome: 'failure',
  duration_ms: number,
  failure_step: 'daemon_spawn' | 'seed_traversal_timeout' | 'mcp_spawn' | 'corpus_find_zero_hits' | 'teardown',
  error_code: string,
}
```

### `uninstall.preflight_failed` event

```typescript
{
  event: 'uninstall.preflight_failed',
  timestamp: ISO8601,
  severity: 'error',
  outcome: 'failure',
  unmet_requirement: 'receipt_missing' | 'receipt_malformed' | 'platform_mismatch',
  details?: {
    receipt_path?: string,
    install_os?: string,
    current_os?: string,
  },
}
```

### `uninstall.step_failed` event

```typescript
{
  event: 'uninstall.step_failed',
  timestamp: ISO8601,
  severity: 'error',
  outcome: 'failure',
  step: 'preflight' | 'mcp_client_config_reverse' | 'firewall_reverse' | 'auto_start_unit_reverse' | 'xdg_subtree_purge' | 'receipt_finalize',
  duration_ms: number,
  error_code: string,
}
```

### `uninstall.completed` event

```typescript
{
  event: 'uninstall.completed',
  timestamp: ISO8601,
  severity: 'info',
  outcome: 'success',
  duration_ms: number,
  purged: boolean,  // true if --purge was passed
}
```

### `taxonomy.promote_completed` event

```typescript
{
  event: 'taxonomy.promote_completed',
  timestamp: ISO8601,
  severity: 'info',
  outcome: 'success',
  axis: 'domain' | 'type' | 'tag' | 'source_type',
  term: string,
  was_already_established: boolean,  // true if no-op
}
```

### `taxonomy.promote_lock_contention` event

```typescript
{
  event: 'taxonomy.promote_lock_contention',
  timestamp: ISO8601,
  severity: 'warning',
  outcome: 'failure',
  lock_holder_hint?: string,  // e.g., 'daemon' if PID file present
}
```

### `taxonomy.promote_missing_term` event

```typescript
{
  event: 'taxonomy.promote_missing_term',
  timestamp: ISO8601,
  severity: 'error',
  outcome: 'failure',
  axis: 'domain' | 'type' | 'tag' | 'source_type',
  term: string,
}
```

---

## Telemetry class registry (SP-007 additions)

The full list of new SP-007 event classes added to the `TelemetryEvent` discriminated union:

**Install (6 classes)**:

- `install.preflight_failed`
- `install.step_failed`
- `install.completed`
- `install.smoke_started`
- `install.smoke_completed`
- `install.smoke_failed`

**Uninstall (3 classes)**:

- `uninstall.preflight_failed`
- `uninstall.step_failed`
- `uninstall.completed`

**Taxonomy Promote (3 classes)**:

- `taxonomy.promote_completed`
- `taxonomy.promote_lock_contention`
- `taxonomy.promote_missing_term`

**Total**: 12 new classes (matches FR-INSTALL-021 + SC-007-033 "≥ 12 new SP-007 event classes"). All ≤ 4096 bytes serialized (Constitution IX). All Zod-validated round-trip in `tests/unit/install-telemetry-classes.test.ts`.

---

## XDG Paths surface (SP-007 reuses; ZERO new getters)

- `Paths.config()` — XDG base for `config.toml`.
- `Paths.configFile()` — full path to `config.toml`.
- `Paths.data()` — XDG base for `documents/`, `CATALOG.md`, etc.
- `Paths.state()` — XDG base for `install-receipt.json`, `daemon.pid`, `telemetry.jsonl`.
- `Paths.cache()` — XDG base for ephemeral caches.
- `Paths.docs()` — body file root.
- `Paths.inbox()` — drop-zone for new documents (smoke harness uses this).
- `Paths.pending()` / `Paths.processed()` / `Paths.failed()` — pipeline routing dirs.
- `Paths.trash()` — soft-delete root.
- `Paths.docsStore()` — substrate-internal storage.
- `Paths.pilotTelemetry()` — SP-001 NFR-008 pilot telemetry root.
- `Paths.indexDb()` — full path to the single-file SQLite index.
- `Paths.drainLock()` — flock target for the SP-003/004/005/006/007 drain-lock contract.
- `Paths.telemetry()` — full path to `telemetry.jsonl`.

Constitution XIV satisfied trivially: ZERO new XDG bases. The `paths-from-resolver-only` ESLint rule applies to all SP-007 source. The MCP-client config path (`~/.claude.json` or `--mcp-client-config <path>`) is the ONLY path the install touches outside `Paths.*` and is recorded explicitly in the install-receipt's `mcp_client_configs[]` array.

---

## State machine: install pipeline (11 steps + optional smoke)

```
[corpus init invoked]
     ↓
[1. Preflight: Node version + Ollama loopback + XDG writable + partial debris]
     ├── Any check fails → install.preflight_failed → non-zero exit; ZERO XDG paths created
     └── All pass ↓
[2. Idempotency check: Paths.indexDb() exists AND install-receipt Zod-validates]
     ├── Yes → re-validate side-effects + print "already initialized" + exit 0
     └── No ↓
[3. XDG subtree creation: fs.mkdir({recursive: true}) × 12 dirs]
     ↓
[4. SQLite open + migrate + PRAGMA wal_checkpoint(TRUNCATE) + unlink WAL/SHM sidecars]
     ↓
[5. Default config.toml write (Zod-validated; preserve operator edits on re-install)]
     ↓
[6. Curated taxonomy seed: acquire drain-lock + BEGIN IMMEDIATE + ≤50 INSERT OR IGNORE + COMMIT + release lock]
     ↓
[7. MCP-client config mutate: read + parse + set mcpServers.corpus + write atomically via withTempDir]
     ↓
[8. OS firewall provision: discriminate os.platform() → runTool('pfctl' | 'iptables', args[]) (with sudo if needed)]
     ├── Existing rule detected → skip (idempotent)
     └── Provision succeeds → record reverse_command in partial-receipt
[9. Optional auto-start unit (only when --enable-autostart): runTool('systemctl', ['--user', 'enable', '--now', ...]) | runTool('launchctl', ['load', ...])]
     ↓
[10. Install-receipt write: assemble + Zod-validate + write atomically via withTempDir]
     ↓
[11. Next-step output: print to stdout the operator's next steps]
     ↓
[install.completed event + exit 0]
     ↓
[12. Optional smoke (only when --smoke): spawn corpus daemon start + drop seed doc + poll for edges-build.completed + spawn corpus mcp + invoke corpus.find + assert ≥1 hit + teardown]
     ├── smoke succeeds → install.smoke_completed event + exit 0
     └── smoke fails → install.smoke_failed event + exit non-zero (NOT undoing steps 1-11)
```

On any step-N failure (steps 3-10): the install-rollback walks the partial-receipt's reverse-list (steps 1..N-1's recorded reverse-commands) and invokes each via `runTool()` (firewall, auto-start) or `fs.rm` (XDG paths, config files). The unwind is idempotent (Constitution X); the partial-receipt is then deleted (NOT preserved with `uninstalled: true` — that's the post-uninstall semantic, not the post-rollback semantic). Then exit non-zero with `install.step_failed`.

---

## State machine: uninstall flow

```
[corpus uninstall invoked]
     ↓
[Preflight: read install-receipt at Paths.state() + '/install-receipt.json'; Zod-validate]
     ├── Receipt missing → uninstall.preflight_failed + non-zero exit
     ├── Receipt malformed → uninstall.preflight_failed + non-zero exit
     ├── Receipt's recorded os ≠ current os.platform() → uninstall.preflight_failed + non-zero exit
     └── All pass ↓
[Detect active daemon (PID file at Paths.state() + '/daemon.pid')]
     ├── Active → runTool('corpus', ['daemon', 'stop']) + wait Constitution VII 2s budget
     │   ├── Daemon stopped → continue
     │   └── Daemon did not stop → uninstall.step_failed + non-zero exit
     └── Not active → continue
[Reverse step 7 (MCP-client config): for each mcp_client_configs entry, delete mcpServers.corpus, write back atomically]
     ↓
[Reverse step 8 (firewall): for each firewall_rules entry, runTool(reverse_command.cmd, reverse_command.args)]
     ↓
[Reverse step 9 (auto-start unit, if recorded): for each auto_start_units entry, runTool(reverse_command.cmd, reverse_command.args) + fs.unlink(unit_path)]
     ↓
[Branch on --purge flag]
     ├── No --purge ↓
[Mark receipt uninstalled + uninstalled_at; write atomically; exit 0 + uninstall.completed event]
     │
     └── --purge ↓
[fs.rm({recursive: true}) for each Paths.config() / Paths.data() / Paths.state() / Paths.cache() scoped to llm-corpus]
     ↓
[Delete install-receipt (already gone if Paths.state() was purged)]
     ↓
[Post-uninstall verification: filesystem diff + firewall query + MCP-client config diff]
     ↓
[exit 0 + uninstall.completed event with purged=true]
```

On SIGINT mid-flow: the partial-uninstall state is recorded by writing the receipt with `uninstalled: <partial-list-of-reversed-side-effects>`. Re-running `corpus uninstall` consults the receipt's reverse-list incrementally; already-reversed side-effects are skipped (Constitution X). The uninstall is itself idempotent.

---

## State machine: `corpus taxonomy promote` flow

```
[corpus taxonomy promote --axis=<v> --term=<t> | --from-proposed-with-count-ge=<N> invoked]
     ↓
[Parse argv → TaxonomyPromoteArgs → Zod-validate]
     ├── Unknown --axis → exit non-zero with valid enum listed
     ├── Both --axis/--term AND --from-proposed-with-count-ge → exit non-zero
     ├── Neither → exit non-zero with usage hint
     └── Valid ↓
[Acquire Paths.drainLock() via flock(LOCK_EX | LOCK_NB)]
     ├── Contention → taxonomy.promote_lock_contention event + non-zero exit; ZERO SQL writes
     └── Acquired ↓
[Open SQLite index; BEGIN IMMEDIATE transaction]
     ↓
[Resolve target rows]
     ├── --axis/--term mode: for each term, SELECT axis, term, state FROM taxonomy_terms WHERE axis=? AND term=?
     │   ├── Missing → taxonomy.promote_missing_term + non-zero exit (ROLLBACK)
     │   ├── state='established' → no-op for this term; stdout "already established: <axis>/<term>"; continue
     │   └── state='proposed' → mark for UPDATE
     └── --from-proposed-with-count-ge mode: SELECT axis, term FROM taxonomy_terms WHERE state='proposed' AND proposed_count >= ?
[UPDATE taxonomy_terms SET state='established', established_at=datetime('now') WHERE (axis, term) IN (...marked...)]
     ↓
[COMMIT transaction]
     ↓
[Release drain-lock]
     ↓
[Emit taxonomy.promote_completed per term + stdout "promoted: <axis>/<term>"]
     ↓
[exit 0]
```

---

## Out-of-band data (NOT in this data model)

- **`install-budget` AbortController + setTimeout handle** — transient. Lives in the install-command's process; cleared on success; on timeout, `controller.abort('install_budget_exceeded')` triggers the rollback flow.
- **`smoke-harness` daemon child process + MCP child process** — transient. Spawned + torn down within the smoke step.
- **`uninstall-active-daemon` PID-file read state** — transient; the receipt-driven uninstall reads `Paths.state() + '/daemon.pid'` once.
- **Sudo password prompt state** — operator-supplied; handled by `runTool()`'s stdin/stderr inheritance; NEVER logged in telemetry (Constitution I + the SP-007 telemetry-or-die contract).

These are documented for completeness but live entirely in process memory.
