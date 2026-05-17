# llm-corpus Session State

**Last updated:** 2026-05-17 — SP-008 Track A merged; **substrate is v1.0.0 release-ready conditional on Track B verdict**
**Authoritative:** this file. Memory pointers in ~/.claude reference here.

## Current status

| Sprint | Scope | Status |
|---|---|---|
| SP-001 | Local-only MCP foundation | ✅ Merged |
| SP-002 | 4 read-only MCP resources (manifest / taxonomy / recent / docs/{id}) | ✅ Merged (PR #3) |
| SP-003 | Ingest pipeline — inbox watcher → validation → hash → normalize → persist | ✅ Merged 2026-05-12 (PR #11; daemon fix #12) |
| SP-004 | Semantic classification — Ollama grammar-constrained metadata + dynamic vocabulary + proposed-term routing | ✅ Merged 2026-05-13 (PR #13, commit 33f233c) |
| SP-005 | Hybrid retrieval — BM25 + dense + graph + confidence + RRF fusion | ✅ Merged 2026-05-13 (PR #14, commit 7592eb9) |
| SP-006 | Kill-9 recovery + `corpus://failures` MCP resource + Tier 1/2/3 fallthrough | ✅ Merged 2026-05-14 (PR #15, squash commit 5237916) |
| SP-007 | `corpus init` + 90-second first-run + `corpus uninstall` + `corpus taxonomy promote` + `corpus failures` + C-046 smoke harness | ✅ Merged 2026-05-16 (PR #16, squash commit 972714c) |
| SP-008 | User-acceptance + Maya engagement-proxy gate (Track A): 4 `engagement.*` event classes + `corpus accept <request-id>` + `corpus engagement-proxy report` + UR-001/002/003 + adversary + C-046 E2E | ✅ **Track A merged 2026-05-17**; Track B verdict PENDING 7-day operator dogfood |

**Branch:** `main` clean. SP-001 through SP-008 Track A all on `main`. **The substrate is FEATURE-COMPLETE for v1.0.0**: all code-track work is shipped. v1.0.0 release ceremony (git tag + npm publish) is conditional on the SP-008 Track B operator-dogfood verdict landing PASS per C-028. Per Constitution XVI: PR-merge ships Track A; Track B is the operator's 7-day dogfood window and is recorded in `specs/008-user-acceptance/RETROSPECTIVE.md`'s Track B Verdict block.

## SP-008 Track A — what shipped (2026-05-17)

- **4 new telemetry event classes** in `packages/contracts/src/engagement.ts`:
  - `engagement.corpus_find_invoked` — fires on every `corpus.find`; carries `request_id`, `query` (or truncated-with-hash for ≥ 1024 chars), `result_count`, `tier_used`, `duration_ms`. (FR-ENGAGEMENT-001.)
  - `engagement.acceptance_event` — fires when operator runs `corpus accept`; keyed by matching `request_id`; optional `acceptance_note ≤ 512 chars`. (FR-ENGAGEMENT-002, Decision B = telemetry-only persistence.)
  - `engagement.report_generated` — fires when operator runs `corpus engagement-proxy report`; audit-trail.
  - `engagement.report_telemetry_parse_failed` — fires on malformed telemetry rows during scan; report continues, `parse_errors_count` increments.
  - Plus additive `request_id?: string` on `SearchQueryEvent` (SP-005) per Decision A — Zod-optional, backward-compatible.
- **`corpus accept <request-id> [--note "<text>"]`** at `packages/cli/src/accept-command.ts` per ADR-016. Idempotent; non-zero exit on unknown request_id or zero-result acceptance.
- **`corpus engagement-proxy report [--since=<ISO>] [--until=<ISO>] [--format=text|json]`** at `packages/cli/src/engagement-proxy-command.ts` per ADR-017. Telemetry-only aggregation; ZERO new SQL tables; ZERO new Paths.* getters; reads + writes audit-trail to existing `Paths.telemetry()`.
- **Constitution XVI Track A/B banner** in text-format report — names "Maya Week-1 engagement-proxy per C-028" and labels the verdict as Track B measurement.
- **Adversary tests**: `packages/cli/test/empty-corpus-adversary.test.ts` (T047) + `packages/cli/test/session-start-idempotency-adversary.test.ts` (T048).
- **C-046 E2E smoke**: `packages/cli/test/engagement-proxy-e2e.test.ts` (T045) — spawns production binary, asserts JSON verdict against synthetic 5q+1a fixture.
- **264 test files, 1240 passing tests, 11 skipped (Ollama-gated), 0 failing.** Constitution Check 16/16. Build + lint + test all green.

## Carry-forward — explicit deferrals still open per FR-ENGAGEMENT-024 + SC-008-036

Both are tracked here, NOT in informal backlog:

- **C-043** (SP-006 carryover): `signals_used: []` reporting bug in `packages/index/src/tier-orchestrator.ts` — the tier orchestrator wraps the SP-005 hybrid retriever but doesn't propagate `signals_used` from inner SearchOutput to outer envelope when tier-fallthrough occurs. Cosmetic but violates FR-RETRIEVAL-002. **Still deferred** per FR-ENGAGEMENT-024 — engagement-proxy report computes metrics from `result_count` + `tier_used`, NOT `signals_used`, so the deferral is not load-bearing for the SP-008 verdict.
- **C-044** (SP-006 carryover): `regenerateCatalogFromDb` in `packages/storage/src/catalog-md-generator.ts` references a non-existent `summary` column on `documents`. Non-fatal — reindex exits 0 even when CATALOG.md regen errors. **Still deferred** per FR-ENGAGEMENT-024 — fires only on `corpus reindex`, NOT on the SP-008 dogfood path.

Both deferrals route to a post-v1 polish PR after the Track B verdict closes.

## SP-008 Track B — operator-driven verdict (PENDING)

The PR-merge for SP-008 Track A does NOT close SP-008. The verdict captured in `specs/008-user-acceptance/RETROSPECTIVE.md`'s Track B Verdict block does.

**Operator workflow** (see `specs/008-user-acceptance/quickstart.md`):

1. Record `DOGFOOD_START` ISO instant at window open.
2. Use the installed substrate naturally for 7 days (drop docs, ask Claude Code questions).
3. Run `corpus accept <request-id> --note "<rationale>"` after useful results.
4. At end-of-window: `corpus engagement-proxy report --since="$DOGFOOD_START" --format=text` + `--format=json`.
5. Paste both outputs into the Track B Verdict block of the retrospective.
6. Open follow-up PR: "SP-008 Track B verdict: PASS — v1.0.0 substrate release-ready" (or FAIL / KILL with C-028 rollback recommendation).

**v1.0.0 release ceremony** (git tag + npm publish) follows a PASS verdict. FAIL (non-KILL) extends the window; FAIL (KILL) triggers a Stage 4 recycle per C-028.

## SP-007 — closed 2026-05-16 with formal retrospective

Retrospective at `specs/007-install-first-run/RETROSPECTIVE.md`. Sprint marked **COMPLETED-WITH-EXPLICIT-DEFERRALS** (C-043 + C-044 explicitly excluded per FR-INSTALL-026 + FR-INSTALL-027; routed to post-SP-007 polish PR).

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

## SP-008 — entry conditions met; spec-kit `/specify` run is the next move

Per `.product/SPRINT-PLAN.yaml` SP-008:
- **Goal**: User-acceptance + Maya engagement-proxy gate (acceptance metric for "AI-native operator value" landed under SP-007's installable substrate).
- **Entry criterion**: `sprint_007_exit_criteria_all_passed` → ✅ satisfied (SP-007 merged 2026-05-16; C-043 + C-044 deferred per FR-INSTALL-026 / 027; no other blockers).
- **Available capability stack**:
  - `npx @llm-corpus/cli init` provisions a working substrate end-to-end in ≤ 90 s.
  - `corpus uninstall [--purge]` reverses every install side-effect from the receipt.
  - `corpus taxonomy promote` resolves the cold-start vocabulary UX (closes C-045).
  - `corpus failures list|show` triages failure-lane sidecars from the human-operator CLI.
  - The C-046 end-to-end smoke spawns the production binary + invokes real MCP-stdio.
- **Folding in from SP-007**: SP-008 should explicitly include/exclude C-043 + C-044 (currently deferred) and decide whether they belong in SP-008 scope or in an independent polish PR.

**Right next step**: invoke the ProductDevelopment skill against SP-008 scope to produce `specs/008-user-acceptance/` with spec.md + plan.md + tasks.md + contracts/ + checklists/.

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
