# Quickstart — Verify Feature 001 Locally

**Feature**: 001-local-only-mcp-foundation
**Date**: 2026-05-05

This quickstart walks through verifying that feature 001's implementation satisfies all 8 SP-001 success criteria from `spec.md` on a developer's primary machine. It assumes the implementation is complete (post-`/speckit-implement`); for SP-001 development time the steps below are the regression suite.

## Prerequisites

- Linux (Fedora 43+ baseline) or macOS. Windows out of scope.
- Node.js 20 LTS or 22 LTS installed. Verify: `node --version`.
- npm (bundled with Node).
- `tcpdump` installed and runnable as the user (Fedora: `sudo dnf install tcpdump`; macOS: pre-installed).
- For SC-004 only: ability to install an OS firewall rule (manual install per ADR-001 §Decision.2 — SP-007 will automate this; for SP-001 the developer runs the install once before the verification suite).
- Repo cloned at `~/Projects/llm-corpus/` on the feature branch `001-local-only-mcp-foundation`.

## Build & Test

```bash
cd ~/Projects/llm-corpus
npm install                              # installs deps; verifies native-addon allowlist post-install (SC-005 will fail-fast here if violated)
npm run build                            # compiles TypeScript; runs build:verify-native-addons
npm run lint                             # NFR-001 forbidden-import scan + Constitution XIII telemetry-or-die check + Constitution XIV path-resolver check
npm run test                             # unit + integration suite; expect all green
```

**Expected outcomes:**

- `npm install` succeeds. If a `.node` addon outside `{better-sqlite3, sqlite-vec}` is present in `node_modules/`, `build:verify-native-addons` fails with a diagnostic naming the offending package — **this is SC-005**.
- `npm run lint` exits 0 with a clean report on a clean repo — **this is SC-001 / NFR-001 happy path**. Add a forbidden import to a pipeline source file and rerun: lint MUST exit non-zero with the offending file + import named.
- `npm run test` runs every test under `tests/`. The integration tests below are the SP-001 regression suite.

## SC-001 — Coverage check (every requirement has a passing scenario)

```bash
npm run test:integration -- --reporter verbose
```

Each of the spec's 17 acceptance scenarios runs as an `it(...)` test. Verify every test passes. If any fails, SC-001 is unmet.

## SC-002 — Zero packets on non-loopback during sentinel cycle

```bash
# Start tcpdump in background, capturing on every non-loopback interface
sudo tcpdump -i any -nn 'not (host 127.0.0.1 or host ::1)' -w /tmp/sp001-tcpdump.pcap &
TCPDUMP_PID=$!

# Run the sentinel ingest-classify-index-find cycle
npm run test:integration -- --grep 'tcpdump-sentinel'

# Stop capture and inspect
sudo kill $TCPDUMP_PID
tcpdump -r /tmp/sp001-tcpdump.pcap -nn | grep -E 'IP|src=' | grep -v "127\.0\.0\.1\|::1"
```

**Expected**: no packets attributable to the corpus process appear in the capture other than loopback. The `tcpdump-sentinel.test.ts` integration test does this entire sequence programmatically and asserts the packet count.

## SC-003 — Worker-thread egress block

```bash
npm run test:integration -- --grep 'worker-shim-refusal'
```

The test attempts to create a Worker without registering the runtime egress guard, asserts that Worker creation is refused, and that a synthetic egress attempt from inside a properly-shimmed Worker is blocked with an `egress.blocked` event recorded.

## SC-004 — Child-process OS-firewall block

**One-time pre-test setup** (until SP-007 automates this):

```bash
# Linux (Fedora; iptables)
sudo iptables -A OUTPUT -m owner --uid-owner $(id -u) -p tcp ! -d 127.0.0.0/8 -j REJECT
sudo iptables -A OUTPUT -m owner --uid-owner $(id -u) -p udp ! -d 127.0.0.0/8 -j REJECT

# macOS (pf) — an equivalent rule installed in /etc/pf.conf, see ADR-001 §Decision.2
```

Then:

```bash
npm run test:integration -- --grep 'child-process-firewall'
```

The test spawns a child process that attempts an outbound connection to `8.8.8.8:53`; asserts the connection is rejected at the OS layer; asserts an `egress.blocked` event with `blocked_at: 'os_firewall'`.

**Cleanup** after testing:

```bash
sudo iptables -D OUTPUT -m owner --uid-owner $(id -u) -p tcp ! -d 127.0.0.0/8 -j REJECT
sudo iptables -D OUTPUT -m owner --uid-owner $(id -u) -p udp ! -d 127.0.0.0/8 -j REJECT
```

(SP-007's install/uninstall will manage these rules automatically.)

## SC-005 — Native-addon allowlist enforcement

```bash
# Add a dummy native addon to dependencies
cd ~/Projects/llm-corpus
npm install --no-save bcrypt           # bcrypt ships a .node addon NOT in our allowlist
npm run build                          # expect failure
```

**Expected**: `build:verify-native-addons` script fails, naming `bcrypt` as the unauthorized addon. Then:

```bash
npm uninstall bcrypt
npm run build                          # expect success
```

## SC-006 — `corpus.find` discoverable via stdio

```bash
# Start the MCP server
npm run mcp:start &
MCP_PID=$!

# Use the MCP SDK Inspector or a direct stdio client to issue tools/list
# (the integration test does this programmatically)
npm run test:integration -- --grep 'mcp-tools-list'

kill $MCP_PID
```

**Expected**: the test asserts that `tools/list` returns exactly one tool named `corpus.find` with both input and output schemas advertised. Cold-start race tests (US1 AS4) verify the `server_initializing` error envelope.

## SC-007 — Bootstrap ordering

```bash
npm run test:integration -- --grep 'bootstrap-order'
```

The test imports modules in reverse-dependency order and asserts that the egress hook is still registered before any pipeline package import would have occurred. Catches regressions where a top-level import pulls in pipeline before the hook bootstraps.

## SC-008 — Always-on plumbing verification (SP-001 partial; SP-005 full coverage)

SP-001 verifies the *plumbing* of always-on enforcement; the full per-stage-per-document coverage proof runs at SP-005 against the real pipeline.

```bash
# SP-001 verifies three things:
#   (a) egress hook installs exactly once before any pipeline-package import
npm run test:integration -- --grep 'hook-install-once'
#   (b) the egress.checkpoint helper is exported and importable from contracts
npm run test:integration -- --grep 'checkpoint-helper-exported'
#   (c) a 10-document smoke fixture through the find-path emits one checkpoint per doc
npm run test:integration -- --grep 'find-path-checkpoint-smoke'
```

**Expected counts in (c)**: 10 `egress.checkpoint` events with `pipeline_stage: 'find'`, one per document.

**Deferred to SP-005**: re-runs the same `egress.checkpoint` assertions against the full ingest → classify → embed → index → find pipeline with a 50-document mixed workload, expecting `50 × 5 = 250` events. SP-005's quickstart will re-verify SC-008 against the real coverage.

This honest partition replaces a prior "stub fixtures simulating future stages" framing — stubs would have proven only that test code emits events, not that production code paths register the hook.

## Pass/Fail Summary

After running all of the above, the SP-001 verification report is:

| Success Criterion | Status |
|---|---|
| SC-001 — Coverage | ☐ |
| SC-002 — Zero packets | ☐ |
| SC-003 — Worker block | ☐ |
| SC-004 — Child-proc firewall block | ☐ |
| SC-005 — Native-addon allowlist | ☐ |
| SC-006 — Tool discoverability | ☐ |
| SC-007 — Bootstrap ordering | ☐ |
| SC-008 — Always-on telemetry | ☐ |

Mark each box ☑ when the corresponding test passes. All eight green ⇒ SP-001 implementation is complete and ready for `/speckit-tasks` retrospective and SP-002 entry.
