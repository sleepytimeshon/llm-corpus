# Phase 0 — Research: Install + 90-Second First-Run UX (`npx @llm-corpus/cli init` + Uninstall + OS Firewall + Curated Seed + `corpus taxonomy promote` + C-046 Smoke)

**Feature**: 007-install-first-run
**Date**: 2026-05-15

This document records the plan-time architectural decisions that gate SP-007. The spec arrived clean from `/speckit-specify` (zero `[NEEDS CLARIFICATION]` markers — every plan-deferred ambiguity is resolved by binding to existing artifacts: SP-001..SP-006 substrate contracts, ADR-001 firewall path (b), the SP-006 retrospective C-045 / C-046 reconciliations, the 16 constitutional principles, and the SP-006 USER-GUIDE.md workaround-list as the curated-seed source-of-truth). The decisions below resolve all SP-007 v1 design space; future sprints (SP-008 user acceptance, v1.5+ Windows port, cross-agent registration, taxonomy demote/delete, auto-update) inherit these decisions and may override only via constitutional amendment or follow-up ADR.

Format: Decision → Recommendation → Rationale → Alternatives considered → Source citations.

---

## Decision A — `npx` package distribution strategy

**Decision**: Publish `@llm-corpus/cli` to the **public npm registry** under the `@llm-corpus/` org scope (Shon-owned, or unscoped `llm-corpus-cli` if the scope is unavailable at publish time). The package declares `"engines": {"node": ">=18.0.0"}` at the operator boundary (preflight rejects Node < 18 per FR-INSTALL-003 with a clear-remediation message), `"bin": {"corpus": "./dist/bin/corpus.js"}` so `npx @llm-corpus/cli init` resolves to the `corpus init` subcommand entry point, and depends on `better-sqlite3 ^11.2.0` + `sqlite-vec ^0.1.0` whose npm-prebuild path supplies binaries for Linux x64 + macOS x64 + macOS arm64. No `gyp` invocation during `npx`. No Docker. No native compile step.

**Rationale**:

- **Public registry is the canonical `npx <pkg> init` UX**: The spec.md US1 acceptance scenario explicitly states `npx @llm-corpus/cli init` as the operator command. Any other distribution (GitHub-hosted tarball, GitHub Packages with token, scope-private with auth) breaks the "single command from a clean machine" UX — the operator would need to configure registry/auth before `npx` can resolve the package. Public registry is what RM-008's `<` 90 s commitment vs Letta / Mem0 depends on.
- **The `@llm-corpus/` org scope is operator-trustable**: A scoped name signals corporate ownership + reduces typosquat risk vs `llm-corpus-cli`. Scope ownership is verified at publish time; if unavailable, fall back to unscoped `llm-corpus-cli` (no functional difference).
- **Prebuild binaries are the no-compile-step path**: `better-sqlite3` and `sqlite-vec` both ship npm-prebuild binaries for the v1 supported platforms. The post-install hook in the monorepo (`build/verify-native-addons.ts`) is RETAINED for SP-007 (it remains a build-time check; runtime npx-install relies on prebuilds being present). If a prebuild is absent for a target (vanishingly rare on v1 supported platforms), the `npm install` step fails BEFORE `corpus init` runs and the operator sees an npm-level error (out-of-scope of SP-007 to handle).
- **The post-install `verify-native-addons.ts` script remains active**: The existing `postinstall` script (`node --import tsx build/verify-native-addons.ts`) runs after `npx`'s package extraction; if any disallowed native addon is present, the install fails before `corpus init` runs. This is the SP-001 build-time native-addon allowlist (ADR-001 §3).

**Alternatives considered**:

- **GitHub-hosted package (e.g., `npx github:owner/repo init`)**: REJECTED. `npx github:...` syntax requires git + clone, breaking the "no compile step" commitment + adding ~3 s to the cold-install budget on a slow network. Public npm is the universal distribution path.
- **GitHub Packages with `--registry` flag + auth**: REJECTED. Operator-facing auth at install time violates the "single command" UX. Future-horizon if Shon wants to limit pre-v1 distribution to a private group, but SP-007's commitment is public.
- **Scope-private package**: REJECTED for v1. Same auth-friction reason as GitHub Packages. Future-horizon if v1.5+ moves to a paid distribution model.
- **Self-extracting bash installer (e.g., `curl ... | bash`)**: REJECTED by Constitution III (substrate, not surface — no shell-script UX layer) + ADR-009 (subprocess hygiene — string-formed shell commands forbidden) + the explicit spec.md commitment to `npx <pkg> init`.
- **Containerized install (`docker run llm-corpus init`)**: FORBIDDEN by NFR-014 "no Docker" + spec.md Out of Scope.

**Source citations**:
- spec.md FR-INSTALL-001 verbatim ("`npx @llm-corpus/cli init` is the canonical install path; the package publishes a single `corpus` binary")
- NFR-014 verbatim ("no Docker, no compile step")
- TR-001 verbatim
- RM-008 success metric vs Letta / Mem0 sub-minute commitment
- ADR-001 §3 native-addon allowlist

---

## Decision B — Cross-platform OS firewall provisioning

**Decision**: At install-step-8, the install provisions a UID-scoped OS firewall rule via `runTool('pfctl', [...])` on macOS (anchor `corpus`, rule blocks outbound non-loopback for the corpus runtime UID; reverse-command `runTool('pfctl', ['-a', 'corpus', '-F', 'all'])`) and `runTool('iptables', [...])` on Linux (chain `OUTPUT`, rule `-m owner --uid-owner <uid> ! -d 127.0.0.1/8 -j REJECT -m comment --comment llm-corpus`; reverse-command swaps `-A` for `-D` with the same rule body). Both invocations are routed through the SP-001 `runTool(cmd, args[], opts)` helper with arg arrays — ZERO string-formed shell commands per Constitution XII. The provisioning is idempotent: existing-rule detection via `pfctl -a corpus -sr | grep corpus-uid` (macOS) or `iptables -C OUTPUT ...` (Linux); on detection, the step is skipped. The reverse-command is recorded in the install-receipt's `firewall_rules[]` array verbatim so `corpus uninstall` can invoke it via `runTool()`.

**Rationale**:

- **ADR-001 path (b) verbatim**: ADR-001 §2 commits to "provision OS-level firewall as a TR-001 install side-effect" with `block out proto {tcp, udp} from any to any user <corpus-uid>` (macOS pf) + `OUTPUT -m owner --uid-owner <corpus-uid> -j REJECT` (Linux iptables). SP-007 implements this verbatim. The spec.md FR-INSTALL-010 cites ADR-001 explicitly.
- **`iptables` legacy over `nft`**: ADR-001 names `iptables`; the spec.md cites ADR-001 verbatim. The Fedora 43+ baseline has both `iptables-legacy` and `nft`; `iptables` (the legacy or nft-backed front-end) is preserved for v1 parity with ADR-001 § "Decision". `nft` migration is future-horizon (v1.5+ if a Fedora release deprecates the `iptables` front-end).
- **`pfctl` anchor for clean reversal**: macOS `pfctl` anchors are operator-friendly: `pfctl -a corpus -f -` writes only the corpus rule + leaves the operator's main `pf.conf` untouched; `pfctl -a corpus -F all` reverses cleanly. Single-line modifications to main `pf.conf` are FORBIDDEN (no main-pf-conf mutation; the operator might have own rules).
- **UID-scoped, not corpus-process-scoped**: The corpus runtime UID is the principal per Constitution IV (single-user single-machine); blocking the UID is stronger than blocking a specific PID (which would let the daemon restart and bypass the rule). Captured via `os.userInfo().uid` at install time.
- **`runTool()` per Constitution XII**: All five subprocesses (`pfctl`, `iptables`, `systemctl`, `launchctl`, `sudo`) go through the existing SP-001 `runTool(cmd, args[], opts)` helper. The `<rule-text>` for pfctl's stdin is JSON-encoded (string literal; no shell interpolation). The `<uid>` is a numeric literal from `os.userInfo().uid`. The SP-001 `no-shell-string-exec` ESLint rule scopes over SP-007 source.
- **Idempotent provisioning**: Re-running `corpus init` over an existing install does not duplicate the rule. The existing-rule detection via `pfctl -a corpus -sr | grep corpus-uid` (macOS) or `iptables -C OUTPUT ...` (Linux) returns success when the rule is present; the install skips the step. This honors Constitution X.
- **Reverse-command capture in receipt**: The install-receipt records the EXACT reverse-command (`{cmd: 'pfctl', args: ['-a', 'corpus', '-F', 'all']}` or `{cmd: 'iptables', args: ['-D', 'OUTPUT', ...]}`) so `corpus uninstall` can invoke it via `runTool()` without re-deriving from the platform — protects against platform-version drift between install and uninstall.

**Alternatives considered**:

- **`nft` (nftables) on Linux**: REJECTED for v1 because ADR-001 names `iptables`. Future-horizon if the iptables front-end is deprecated; the SP-007 firewall-provisioner is structured so the platform-discrimination function can dispatch to a future `nft` provisioner without touching the install-receipt schema (which records reverse-command, OS, anchor/chain — all `nft`-compatible).
- **OS-level firewall via `firewalld` (Fedora's default GUI front-end)**: REJECTED. `firewalld` operates at zone level; the corpus rule is UID-scoped which `firewalld` handles awkwardly via direct-rules. `iptables` is direct + ADR-001-verbatim.
- **macOS `pf` via `/etc/pf.conf` direct edit**: REJECTED. Mutating the operator's main pf.conf is operator-hostile + non-reversible cleanly. Anchor-based rules (`pfctl -a corpus`) are the supported isolation path.
- **OS firewall not provisioned at install (operator manual setup)**: REJECTED by ADR-001 verbatim "the firewall rule is installed automatically by TR-001 as a required install side-effect". The whole point of ADR-001 path (b) is that the rule is automatic, not documented.
- **No firewall (rely on JS-land egress hook only)**: REJECTED by ADR-001 §"Consequences": "child_process and native-addon exclusions must be permanent constraints; any future requirement to spawn subprocesses or load arbitrary native addons re-opens NFR-002". The OS firewall is the defense-in-depth layer against subprocesses bypassing the JS-land hook.
- **Skip firewall on systems without `pfctl`/`iptables`**: REJECTED. The install exits non-zero with a clear-remediation message naming the missing binary. The OS firewall rule is REQUIRED per ADR-001 § "the firewall rule is installed automatically by TR-001"; without it, ADR-001 path (b) is unfulfilled. Operator workarounds (manual rule + skip-install flag) are FORBIDDEN for v1.

**Source citations**:
- ADR-001 §2 path (b) verbatim
- ADR-001 §"the firewall rule is installed automatically by TR-001 as a required install side-effect"
- spec.md FR-INSTALL-010 verbatim
- spec.md SC-007-011 + SC-007-015
- Constitution XII (subprocess hygiene)
- Constitution X (idempotent transitions)

---

## Decision C — `config.toml` shape at first-run

**Decision**: The install writes a minimal `config.toml` at `Paths.configFile()` with the SP-001..SP-006 defaults baked in. The shape:

```toml
[classifier]
model = "qwen3:8b"

[embedder]
model = "nomic-embed-text"

[search]
min_results = 3
tier_total_budget_ms = 600

[ingest]
max_doc_size_bytes = <SP-003 default; reused verbatim>

[telemetry]
rotate_at_bytes = <SP-003 default; reused verbatim>

[ranker.confidence_weights]
# Inherited from packages/index/src/confidence-adapter.ts DEFAULT_CONFIDENCE_WEIGHTS
# research-paper=1.20, manual=1.10, form=1.10, reference=1.10, article=1.00,
# notes=0.95, transcript=0.90, podcast=0.90, video=0.90, book=1.05
```

Every value is Zod-validated against the existing `ConfigTomlZodSchema` from `packages/contracts/src/` (SP-001+). If the operator re-runs `corpus init` over an existing config file, the install does NOT overwrite the operator's edits (idempotent per FR-INSTALL-004 + Constitution X).

**Rationale**:

- **Minimal viable config + defer to embedded defaults**: The SP-001..SP-006 substrate already has working defaults for every knob. The install's job is to make those defaults visible (so the operator can tune later) without forcing the operator to read documentation to make `corpus init` work.
- **Cite the SP-004/SP-005 model defaults explicitly**: `qwen3:8b` is the SP-004 classifier default; `nomic-embed-text` is the SP-005 embedder default. Both are pulled by the operator's Ollama before `corpus init` (per FR-INSTALL-003 preflight). Writing them in `config.toml` documents the choice.
- **`min_results=3` + `tier_total_budget_ms=600` are SP-006 defaults**: Inherited per the SP-006 plan.md "Decisions G / E" — the tier-fallthrough threshold is 3 hits at Tier 0; the aggregate budget is 600 ms. Documented in `config.toml` for operator tuning.
- **`ranker.confidence_weights` is a comment, not a value**: The defaults live in code (`DEFAULT_CONFIDENCE_WEIGHTS`). Writing them as a comment in `config.toml` gives the operator a starting point for tuning without forcing an active default in the file (which would be brittle to future SP-007+ default changes).
- **Idempotent on re-run**: If the operator edited `config.toml` between installs, the install preserves their edits. The install's `config.toml` write is gated by a preflight `fs.existsSync(Paths.configFile())` check; on existing file, the install logs `"config.toml exists; preserving operator edits"` and skips the step. The install-receipt records that the file was NOT written (so uninstall doesn't delete an operator-authored file).
- **Zod-validated**: Per Constitution V + FR-INSTALL-020. The `ConfigTomlZodSchema` is the SP-001 contract; writing a config that doesn't validate fails the install at step 5.

**Alternatives considered**:

- **No `config.toml` at install (defaults-only via library)**: REJECTED. The operator has no discoverability into the knobs; "config.toml exists" is the prompt to read the documentation. Writing the file with comments is the lightweight discoverability path.
- **Full-fat `config.toml` with every knob enumerated**: REJECTED. The substrate has ~30 knobs across SP-001..SP-006; enumerating all of them produces a config file the operator won't read. Minimal + comments + documentation pointer is the practitioner path.
- **Interactive `corpus init` wizard for config values**: FORBIDDEN by AG-001 (no UI) + spec.md Out of Scope ("TUI / interactive install wizard").
- **JSON config instead of TOML**: REJECTED. The SP-001+ `ConfigTomlZodSchema` is TOML; SP-007 doesn't change the format.
- **Per-environment configs (dev/prod)**: REJECTED. Single-user single-machine per Constitution IV; no environment dimension.

**Source citations**:
- spec.md FR-INSTALL-007 verbatim
- spec.md SC-007-008
- Constitution V (Zod boundaries)
- Constitution X (idempotency on re-run)
- SP-001..SP-006 `ConfigTomlZodSchema` contract
- SP-006 plan.md Decisions G + E (tier-fallthrough defaults)

---

## Decision D — Curated taxonomy seed: storage, sourcing, versioning

**Decision**: The curated seed is a JSON file at `packages/cli/src/install-resources/taxonomy-seed.json`, bundled into the published `@llm-corpus/cli` package via the package's `files` field. Shape:

```json
[
  {"axis": "domain", "term": "engineering"},
  {"axis": "domain", "term": "personal-finance"},
  {"axis": "domain", "term": "health"},
  {"axis": "domain", "term": "writing"},
  {"axis": "domain", "term": "reference"},
  {"axis": "type", "term": "article"},
  ... (six type entries)
  {"axis": "tag", "term": "..."},
  ... (nine tag entries)
  {"axis": "source_type", "term": "..."}
  ... (five source_type entries)
]
```

Floor: 25 entries (5 domains + 6 types + 9 tags + 5 source_types from the SP-006 USER-GUIDE.md workaround list). Cap: 50 entries per the dispatch prompt C-045 "≤ 50-term seed". The exact term list is curated by Shon at SP-007 plan-stage; the final list is committed as part of the SP-007 implementation (in tasks.md). The seed is Zod-validated against `TaxonomySeedZodSchema = z.array(TaxonomySeedEntryZodSchema).min(25).max(50)` at install time before insert. Insertion is bulk: `INSERT OR IGNORE INTO taxonomy_terms (axis, term, state, established_at) VALUES ...` in a single transaction (Constitution VIII + IX); existing operator-authored entries (proposed or established) are NOT modified per Constitution X. The seed is versioned with the CLI package (the seed travels with the binary; future seed expansions ship in a new SP-007+ CLI release). Operator override via a `--seed-file <path>` flag is OUT-OF-SCOPE for v1 per spec.md Out of Scope (future-horizon).

**Rationale**:

- **JSON over TS-constant for inspectability**: A code constant in `taxonomy-seed.ts` would be harder for the operator to inspect (the operator can `cat packages/cli/src/install-resources/taxonomy-seed.json` post-install or before publish to know what's seeded). JSON is operator-readable.
- **Bundled into the published package**: The `files` field in `packages/cli/package.json` includes `src/install-resources/taxonomy-seed.json` (or after build, `dist/install-resources/taxonomy-seed.json`). The seed travels with the CLI binary; `npx @llm-corpus/cli init` ships a self-contained installer.
- **SP-006 USER-GUIDE.md workaround list as source-of-truth**: The dispatch prompt + spec.md FR-INSTALL-008 cite this list explicitly: 5 domains, 6 types, 9 tags, 5 source_types = 25-term floor. This list is the documented operator-workaround for cold-start vocabulary in SP-006; SP-007 codifies it as the canonical seed.
- **Cap at 50 per C-045**: The dispatch prompt's C-045 recommendation says "≤ 50-term seed". Larger seeds risk pre-populating taxonomy that doesn't match the operator's corpus (operator-hostile); the curated seed is the 80%-coverage subset for typical operator corpora.
- **`INSERT OR IGNORE` for idempotency**: Re-running `corpus init` doesn't duplicate seeded rows; the SP-004 `taxonomy_terms` schema has `UNIQUE(axis, term)` (or equivalent); `INSERT OR IGNORE` collapses re-inserts. Operator-authored entries (proposed or established) with the same `(axis, term)` are preserved (not overwritten); this is the Constitution X idempotency contract.
- **Single transaction**: `BEGIN IMMEDIATE → ≤ 50 INSERT OR IGNORE → COMMIT` per Constitution VIII + IX. Under `Paths.drainLock()` per Constitution IX (the install's lock-acquiring step).
- **Override flag out-of-scope for v1**: The dispatch prompt + spec.md commit to the curated seed as the v1 path. A `--seed-file <path>` override is a v1.5+ knob.

**Alternatives considered**:

- **Code constant in TypeScript**: REJECTED for operator inspectability (above).
- **`config.toml`-embedded seed**: REJECTED. The seed is bulk-loaded once at install + may grow to 50 entries; `config.toml` is for tunable values, not bulk data.
- **Seed loaded from a remote URL**: REJECTED by Constitution I (no egress). The seed must be local-bundled.
- **No seed (operator must populate `taxonomy_terms` manually post-install)**: REJECTED by C-045 dispatch prompt recommendation + spec.md FR-INSTALL-008. Operators on a fresh install cannot classify any document until the established taxonomy is seeded; the install owns this bootstrap.
- **Seed from the SP-004 classifier proposed-term output on a sample corpus**: REJECTED. The classifier's proposed-term output requires the classifier to have run, which requires the daemon to be running, which requires the install to be complete — circular dependency. The seed is human-curated by Shon at SP-007 plan-stage.
- **Larger seed (200+ terms across operator-domain spectra)**: REJECTED by dispatch prompt "≤ 50-term cap". Larger seeds risk operator-hostile pre-population.
- **Smaller seed (only the 5 domain entries)**: REJECTED. The 25-term floor matches the 5+6+9+5 partition (domain + type + tag + source_type) — without all four axes seeded, the classifier hits the same C-045 wall on whichever axis is missing.

**Source citations**:
- spec.md FR-INSTALL-008 verbatim
- spec.md SC-007-009
- Dispatch prompt C-045 recommendation (a) + (b)
- SP-006 USER-GUIDE.md workaround list (the documented source-of-truth)
- Constitution X (idempotent INSERT OR IGNORE)
- Constitution V (TaxonomySeedZodSchema at insert time)
- Constitution VIII + IX (single transaction under drain-lock)

---

## Decision E — Auto-start mechanism (systemd / launchd) opt-in semantics

**Decision**: SP-007 ships an optional auto-start unit installer activated only by the `--enable-autostart` flag on `corpus init` (default OFF). On Linux + `--enable-autostart`, the install writes `~/.config/systemd/user/corpus.service` with:

```ini
[Unit]
Description=llm-corpus daemon
After=default.target

[Service]
ExecStart=<absolute corpus binary path> daemon start
Restart=on-failure

[Install]
WantedBy=default.target
```

then invokes `runTool('systemctl', ['--user', 'enable', '--now', 'corpus.service'])`. On macOS + `--enable-autostart`, the install writes `~/Library/LaunchAgents/io.llm-corpus.daemon.plist` with the `<ExecStart>` array pointing at the absolute corpus binary path + `<KeepAlive>` set + `<RunAtLoad>` set, then invokes `runTool('launchctl', ['load', '<plist-path>'])`. The unit-file paths and reverse-commands (`systemctl --user disable corpus.service`, `rm <unit-path>`; `launchctl unload <plist>`, `rm <plist>`) are recorded in the install-receipt's `auto_start_units[]` array verbatim so `corpus uninstall` can invoke them via `runTool()`. Without `--enable-autostart`, no unit file is written; the operator manually runs `corpus daemon start` post-install.

**Rationale**:

- **Default OFF protects the 90-second budget**: The auto-start unit installation adds 1-3 s wall-clock (file write + systemd reload + `--now` daemon start). For a 90-second budget, this is 1-3% overhead; not blocking but worth deferring to operator opt-in for the common case.
- **Default OFF avoids operator surprise**: A first-run operator may not want a daemon auto-starting on every boot before they've explored the corpus. Opt-in via `--enable-autostart` is the practitioner-grade default.
- **systemd user mode, not system mode**: Single-user single-machine per Constitution IV; the daemon runs as the operator's UID, not root. `systemctl --user` is the right verb (no sudo needed for the unit; sudo is only needed for the firewall provisioning at install-step-8).
- **launchd LaunchAgents, not LaunchDaemons**: Same reasoning — single-user per-machine; `LaunchAgents/` is per-user, `LaunchDaemons/` is system-wide.
- **Both invocations via `runTool()`**: Per Constitution XII; ZERO string-formed shell commands.
- **Reverse-command capture in receipt**: Same as Decision B (firewall provisioning) — uninstall invokes the recorded reverse-command verbatim, protecting against platform-version drift.
- **Conflict detection with operator-authored unit**: If a unit file already exists at the install's target path (the operator hand-wrote one for the Pallas-side D-027 install on pai-node01), the install exits non-zero with a clear-remediation message offering `--force-autostart` to overwrite; the operator can also opt out via `--no-autostart`. Documented in spec.md Edge Cases.

**Alternatives considered**:

- **Default ON for auto-start**: REJECTED. 90-second-budget overhead + operator-surprise reasons (above). The operator can opt in explicitly.
- **Always install + always enable (`systemctl enable`) without operator opt-in**: REJECTED. Same surprise reason; some operators want explicit control over which daemons run at boot.
- **systemd timer or path-activation unit instead of `[Service]`**: REJECTED for v1. Future-horizon if the operator workflow demands lazy-start (drop-doc-and-wait); the v1 daemon is the operator-explicit-start model.
- **Pre-write the unit at install-time without enabling (operator runs `systemctl --user enable` manually)**: REJECTED. Adds friction without value; if the operator passed `--enable-autostart` they want the daemon active.
- **Wrap auto-start in `corpus init` non-interactively asking "enable auto-start? [y/N]"**: REJECTED by AG-001 (no UI / TUI / interactive install wizard) + spec.md Out of Scope.

**Source citations**:
- spec.md FR-INSTALL-011 verbatim
- spec.md Edge Cases (auto-start unit conflict)
- spec.md Assumptions ("Auto-start is OFF by default")
- Constitution IV (single-user)
- Constitution XII (subprocess hygiene)

---

## Cross-Decision: Plan-stage facts pre-resolved in spec.md (not re-litigated here)

The spec.md Notes section enumerates 12 plan-stage decisions deliberately resolved at /speckit-specify time (not flagged as spec-level ambiguities). For traceability, they are:

(a) install path = `npx @llm-corpus/cli init` → confirmed by Decision A.
(b) install steps = 11-step pipeline + optional 12th smoke step → confirmed in plan.md "Performance Goals" sub-budget table.
(c) preflight = Node version + Ollama reachability + XDG writable + partial-install detection → confirmed in plan.md "Technical Context".
(d) curated seed source = SP-006 USER-GUIDE.md workaround list → confirmed by Decision D.
(e) MCP-client config = `~/.claude.json` default, `--mcp-client-config <path>` override → confirmed in plan.md "Technical Context".
(f) firewall provisioning = ADR-001 path (b) UID-scoped rule via `pfctl`/`iptables` through `runTool()` → confirmed by Decision B.
(g) install-receipt = JSON at `Paths.state() + '/install-receipt.json'` with `schema_version: 1` → confirmed in data-model.md Entity 1.
(h) auto-start = opt-in via `--enable-autostart`, default OFF → confirmed by Decision E.
(i) uninstall = receipt-driven; XDG subtree preserved without `--purge`; firewall + MCP-client + auto-start reversed unconditionally → confirmed in plan.md "Summary" + contracts/adr-install-uninstall-surface.md.
(j) taxonomy promote = `corpus taxonomy promote --axis=<v> --term=<t>` OR `--from-proposed-with-count-ge=<N>`, drain-lock-serialized → confirmed in contracts/adr-taxonomy-promote-cli.md.
(k) C-046 smoke harness = `corpus init --smoke` + `packages/cli/test/smoke-e2e.test.ts` → confirmed in plan.md "Testing".
(l) C-043 + C-044 = deferred to post-SP-007 polish PR → confirmed in spec.md FR-INSTALL-026 + FR-INSTALL-027.

These are NOT independent decisions in the research log; they are spec.md commitments that the plan-stage research confirms feasibility for.

---

## Open decisions (deferred OUT of SP-007)

For traceability — what SP-007 explicitly does NOT decide:

- **C-043 (`signals_used: []`) fix architecture** — DEFERRED to post-SP-007 polish PR per FR-INSTALL-026.
- **C-044 (`summary` column) fix architecture** — DEFERRED to post-SP-007 polish PR per FR-INSTALL-027.
- **Windows firewall + service provisioning paths** — OUT OF SCOPE for v1.
- **Cross-agent MCP-client registration (Gemini CLI, Codex CLI, custom MCP clients)** — OUT OF SCOPE per FR-022/023, NFR-007/008, AG-004/OOS-011.
- **Bundled Ollama auto-install** — OUT OF SCOPE; operator-installed prerequisite.
- **`corpus failures clear/retry` CLI** — OUT OF SCOPE; preserved from SP-006 Out of Scope.
- **`corpus taxonomy demote/delete` CLI** — OUT OF SCOPE for v1; operator manual SQL fallback documented.
- **Auto-update / version bumping** — OUT OF SCOPE; operator manual `npm update -g` or new `npx @llm-corpus/cli@<v> init`.
- **D-027 (Pallas-side bash-shim install) migration tooling** — OUT OF SCOPE; manual `corpus uninstall --purge` + re-install per spec.md Out of Scope.
- **`corpus health` / `corpus status` observability commands** — OUT OF SCOPE for SP-007; future-horizon for SP-008+ if operator gap surfaces.
- **`--seed-file <path>` override flag for the curated taxonomy seed** — OUT OF SCOPE for v1 per Decision D Alternatives Considered.
- **`nft` migration path** — OUT OF SCOPE for v1 per Decision B Alternatives Considered.

These are documented for traceability — the SP-007 build does NOT touch them, and their absence does not block any SP-007 acceptance scenario.

---

## Phase 0 Exit Gate

All Decisions A through E are RESOLVED with explicit recommendations + source citations + alternatives considered. Zero `[NEEDS CLARIFICATION]` markers remain. The plan.md Constitution Check Phase 0 → Phase 1 gate is PASSED.
