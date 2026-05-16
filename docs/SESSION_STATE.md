# llm-corpus Session State

**Last updated:** 2026-05-14 — SP-006 merged; **llm-corpus substrate is PRODUCTION-READY**
**Authoritative:** this file. Memory pointers in ~/.claude reference here.

## Current status

| Sprint | Scope | Status |
|---|---|---|
| SP-001 | Local-only MCP foundation | ✅ Merged |
| SP-002 | 4 read-only MCP resources (manifest / taxonomy / recent / docs/{id}) | ✅ Merged (PR #3) |
| SP-003 | Ingest pipeline — inbox watcher → validation → hash → normalize → persist | ✅ Merged 2026-05-12 (PR #11; daemon fix #12) |
| SP-004 | Semantic classification — Ollama grammar-constrained metadata + dynamic vocabulary + proposed-term routing | ✅ Merged 2026-05-13 (PR #13, commit 33f233c) |
| SP-005 | Hybrid retrieval — BM25 + dense + graph + confidence + RRF fusion | ✅ Merged 2026-05-13 (PR #14, commit 7592eb9) |
| SP-006 | Kill-9 recovery + `corpus://failures` MCP resource + Tier 1/2/3 fallthrough | ✅ **Merged 2026-05-14 (PR #15, squash commit 5237916)** |

**Branch:** `main` clean. SP-001 through SP-006 all on `main`. **The substrate is FEATURE-COMPLETE at the SP-006 scope** — but per roadmap (`.product/ROADMAP.yaml`) there are still **two planned sprints ahead**: SP-007 (install + 90-second first-run UX) and SP-008 (user-acceptance + Maya engagement-proxy gate). The 2026-05-14 production install on pai-node01 is an SP-007 ADVANCE deliverable, not the SP-007 sprint itself.

## SP-006 — closed 2026-05-15 with formal retrospective

Retrospective at `specs/006-hardening/RETROSPECTIVE.md`. Sprint marked **COMPLETED-WITH-KNOWN-ISSUES**. Five new issues recorded in `.product/ledgers/concerns.jsonl` (C-043..C-047); five decisions in `.product/ledgers/decisions.jsonl` (D-023..D-027).

**Known issues from SP-006 (now tracked in ledgers, NOT informal backlog):**

| ID | Severity | Issue | Routing |
|---|---|---|---|
| C-043 | low | `signals_used: []` even when hits returned (FR-RETRIEVAL-002 violation) | SP-007 scope candidate or polish PR |
| C-044 | low | `regenerateCatalogFromDb` references non-existent `summary` column | SP-007 scope candidate or polish PR |
| C-045 | **high** | Cold-start vocabulary UX gap — substrate cannot classify first doc on fresh install | SP-007 scope (UX-blocking) |
| C-046 | medium | SP-006 review process gap — no end-to-end CLI→MCP→search smoke | ProductDevelopment skill template improvement |
| C-047 | medium | Pallas-side process drift (hot-fixes on main without discipline) | **Closed by this retro** |

**Post-merge code commits to main (now reconciled via ledger):**

| Commit | Decision | Sprint discipline |
|---|---|---|
| `6b8ba22` | D-024 — classifier model `qwen3.5:9b` → `qwen3:8b` | Was ad-hoc; reconciled in retro |
| `53c7bc2` | D-025 + D-026 — MCP transport wire-up + Ollama `keep_alive: '30m'` | Was ad-hoc; reconciled in retro |
| `1678e0a`, `68ff55f`, `b854016` | Docs updates | Legitimate end-of-sprint docs work |

## SP-007 — entry conditions met; spec-kit `/specify` run is the next move

Per `.product/SPRINT-PLAN.yaml` SP-007:
- **Goal**: Ship install + 90-second first-run UX (TR-001, TR-002, NFR-014, NFR-010, NFR-006) so `npx` invocation provisions a working corpus within 90 seconds.
- **Entry criterion**: `sprint_006_exit_criteria_all_passed` → ✅ satisfied
- **Already-done as advance deliverable (D-027)**: bash shim at `~/.local/bin/corpus`, XDG subtree at `~/.local/share/llm-corpus/`, systemd user unit, MCP server registered. The SP-007 spec will need to reconcile what's done vs what's still needed (the `corpus init` subcommand, `npx` package, 90-second first-run automation, taxonomy promotion CLI per C-045 mitigation).
- **Folding in from C-043, C-044, C-045**: SP-007 spec author should explicitly include/exclude each, with rationale.

**Right next step**: invoke the ProductDevelopment skill against SP-007 scope to produce `specs/007-install-first-run/` with spec.md + plan.md + tasks.md + contracts/ + checklists/, exactly as SP-006 was produced. **Do NOT continue with ad-hoc fixes on main.**

## SP-006 implementation summary (2026-05-14)

- **Phase 2** — PREREQ contracts: Zod schemas for `FailureEntry` / `FailuresQuery` / `FailuresResourceResponse`; 14 SP-006 telemetry event classes (9 recovery.* + 1 failures.sidecar_parse_failed + 4 search.tier_*); 6 typed errors; extended PolicySchema with 7 SP-006 knobs; SearchHit.tier_used widened to enum.
- **Phase 3** — `packages/pipeline/src/recovery-scanner.ts` + `recovery-resumability.ts` + sidecar writer; daemon startup hook fires BEFORE the inbox watcher.
- **Phase 4** — `packages/storage/src/failures-resource-adapter.ts` + `packages/transport/src/failures-resource-handler.ts`; fifth MCP resource alongside SP-002's four. Engineer #5 added `emitResourceRead('corpus://failures', ...)` per SP-002 telemetry parity.
- **Phase 5** — `packages/index/src/tier-orchestrator.ts` + `bm25-only-tier.ts` + `catalog-grep-tier.ts` + `fs-grep-tier.ts`; `packages/storage/src/catalog-md-generator.ts`; `corpus reindex --no-catalog` flag. Engineer #5 cutover: `packages/transport/src/corpus-find-tool.ts` now delegates to `runTieredSearch` (the cascade is LIVE in production-mode `corpus.find`).
- **Phase 6** — ESLint custom rules verified covering all SP-006 paths (`no-process-exit-in-libs`, `paths-from-resolver-only`, `no-shell-string-exec`, `no-forbidden-network-imports`, `no-writes-from-resource-handlers`). Three new test files: `tests/lint-fixtures/sp006-constitutional-grep.test.ts`, `tests/lint-fixtures/sp006-no-mcp-mutation-surfaces.test.ts`, `tests/integration/sp006-telemetry-no-body-content.test.ts`.
- **Phase 7** — `npm run build` 0, `npm run lint` 0, `npm run test` 878 passing / 5 skipped. Constitution Check 16/16 re-verified.

**Deferred to post-merge polish PR:** T060–T063 (live pai-node01 p95 measurement), T064 (requirements.md outcome marking), T065 (CLAUDE.md SP-006 surface section), T066 (`.specify/feature.json` update).

## Install-ready milestone — REACHED

The substrate is install-ready in the sense the user directed:

| Capability | Sprint | State |
|---|---|---|
| User drops files in inbox, system ingests | SP-003 | ✅ Ready |
| System classifies metadata so the corpus is structured | SP-004 | ✅ Ready |
| System embeds + indexes for semantic search | SP-005 | ✅ Ready |
| `corpus.find` MCP tool returns ranked relevant docs | SP-005 | ✅ Ready |
| `corpus reindex [--dry-run]` CLI for manual backfill | SP-005 | ✅ Ready |
| Daemon survives SIGKILL mid-pipeline; recovers on restart | SP-006 | ✅ **Ready** |
| `corpus://failures` MCP resource exposes failed-lane sidecars | SP-006 | ✅ **Ready** |
| Tier 1/2/3 fallthrough on sparse Tier 0 (BM25-only → CATALOG grep → fs-grep) | SP-006 | ✅ **Ready** |
| Per-tier latency budget enforced via AbortController | SP-006 | ✅ **Ready** |
| `corpus reindex [--no-catalog]` to skip CATALOG.md regeneration | SP-006 | ✅ **Ready** |

The agent can now:
1. Drop documents into `Paths.inbox()`
2. Wait for the daemon's autonomous chain (ingest → classify → embed → index → edges-build)
3. Call `corpus.find` via the MCP tool and receive ranked SearchHit lists with `score`, `uri`, `title`, `facet_domain`, `facet_type`, `tags`, `snippet`

### What you need to install (on a fresh machine)

1. Clone the repo, `npm install`
2. Pull two Ollama models:
   - `ollama pull qwen3.5:9b` (or `gemma3:4b` for lighter; for SP-004 classifier)
   - `ollama pull nomic-embed-text` (for SP-005 embeddings)
3. `npm run build`
4. `node packages/cli/dist/index.js init`
5. `node packages/cli/dist/index.js daemon` to start autonomous processing
6. Drop files into `$CORPUS_HOME/data/inbox/` to begin filling with knowledge

Walkthrough details: `specs/004-classifier/quickstart.md` + `specs/005-retrieval/quickstart.md`.

## SP-006 — production hardening (next sprint, NOT install-blocking)

Per SP-003 plan.md defer list and SP-005 anti-scope:

- **Kill-9 cross-stage recovery** — currently if the process is killed mid-classify or mid-embed, the row may be in an inconsistent state until the next drain catches it. SP-006 adds explicit recovery semantics: on daemon startup, detect orphaned in-flight work and either resume or fail-cleanly.
- **`corpus://failures` MCP resource** — currently failure-lane `.error.json` sidecars live on disk; SP-006 exposes them as a read-only MCP resource so agents can introspect what failed and why.
- **Tier 1/2/3 fallthrough** — Tier 0 (hybrid) is the only tier shipped; Tier 1 (BM25-only fast path), Tier 2 (grep CATALOG.md), Tier 3 (filesystem grep over `docs/`) are not yet wired. The tier model in ARCHITECTURE-FINAL §10.6 specifies latency targets for each tier; SP-006 builds the fallthrough.

## Resumption protocol (continued from SP-004 era)

Pallas owns all tactical workflow per Shon's standing directive (2026-05-12+):
- PR creation / merges / branch ceremony
- Constitution-check failures (resolved by Pallas, never escalated)
- Agent management / swarming / context budgeting

User involvement only when:
- 100% required (genuine blocker)
- Major milestone reached (install-ready, SP-006 complete, etc.)

When the user types continuation signal ("keep going", "continue", etc.), the next autonomous turn picks up at SP-006 hardening.

## Pre-resolved constraints for SP-006

- Kill-9 recovery: leverage the existing telemetry JSONL append-only log to detect in-flight work; on daemon startup, scan for `*.started` events without matching `*.completed` / `*.failed`
- `corpus://failures` resource: read-only MCP resource per Constitution III; list `Paths.failed()/*.error.json` sidecar files; return structured error envelope per FR-004
- Tier fallthrough: implemented in the search orchestrator; if Tier 0 (hybrid) returns fewer than `min_results` hits, fall through to Tier 1 (BM25-only on FTS5 — same table, lighter query), then Tier 2 (grep CATALOG.md), then Tier 3 (filesystem grep over `docs/`). Each tier has an aggregate latency budget; matched tier reported in hit metadata.

## Operating principles invoked (carries forward from SP-004 / SP-005)

- `feedback-pallas-drives-tactical-workflow` — methodology, ceremony, plumbing owned by Pallas
- `feedback-no-stop-recommendations` — continue executing under max-effort directive
- `feedback-pr-merges-and-ceremony-are-mine` — Pallas decides merge timing
- `feedback-primary-sources-only` — verify subagent claims with tools
- `feedback-verify-or-retract` — every load-bearing claim is tool-verified
- `feedback-build-tier-sizing-rule` — split builds; SP-005 single-dispatch succeeded at ~8.6K LOC
- `feedback-spec-contradictions-pre-build-lint` — pre-build review catches design drift (caught the SP-005 single-transaction claim against the actual two-transaction implementation)
