# Phase 0 — Research: Production Hardening (Kill-9 Recovery + `corpus://failures` + Tier Fallthrough)

**Feature**: 006-hardening
**Date**: 2026-05-13

This document records the plan-time architectural decisions that gate SP-006. The spec arrived clean from `/speckit-specify` (zero `[NEEDS CLARIFICATION]` markers — every plan-deferred ambiguity is resolved here or in `data-model.md`). The decisions below resolve all SP-006 v1 design space; future sprints (v1.5+ retrieval-eval harness, future Tier 4+, cleanup CLIs, eval-driven recovery tuning) inherit these decisions and can override only via constitutional amendment or follow-up ADR.

Format: Decision → Recommendation → Rationale → Alternatives considered → Source citations.

---

## Decision A — Recovery detection algorithm

**Decision**: Scan `Paths.telemetry()` JSONL backwards from end-of-file to the most-recent `daemon.started` marker. Build a map of `*.started` events keyed by `(doc_id, stage)`. For each entry, check whether a corresponding `*.completed` or `*.failed` event exists later in the same daemon-session log range. If not → orphan.

**Rationale**:

- **Telemetry log is the canonical source of truth for in-flight state**: SP-001's telemetry-or-die contract (Constitution XIII) ensures every state transition emits a Zod-validated event before throwing or returning. The log is append-only and durable. The `*.started` / `*.completed` / `*.failed` event pairs delimit every stage's lifecycle. Orphans are precisely the `*.started` events without a matching closer in the same daemon session.
- **Bounded by `daemon.started` markers**: Each daemon-process boot emits a `daemon.started` event. The scan window is bounded by the MOST-RECENT prior `daemon.started` — events before that are from older sessions whose orphans were either resolved in their own recovery cycle OR fail-cleaned with a `.recovery.error.json` sidecar already on disk. This makes the scan window bounded and the recovery deterministic.
- **Reverse-line iteration is efficient on append-only logs**: Reading from end-of-file backwards, splitting on newlines, lets the scanner stop as soon as the `daemon.started` marker is found. For typical sessions (1000-10000 events), this completes in < 1 s on pai-node01.
- **Graceful degradation on malformed lines**: Per Constitution XIII + R2 in plan.md, malformed last lines (partial write from the SIGKILL itself) are skipped with a `recovery.telemetry_parse_failed` event. The scan continues with the previous well-formed line.
- **Idempotent re-running**: Running the scan twice produces the same orphan set (Constitution X). The scanner's own session boundaries via `recovery.scan_started` + `recovery.scan_completed` events allow Scenario 5 of US1 (recovery-during-recovery) to be detected.

**Alternatives considered**:

- **Database-driven state machine (a `pipeline_state` SQL table tracking each row's current stage)**: Would require an additional table + UPDATE on every state transition. Reject: doubles the SQL write burden; tight coupling between recovery and the SQL schema; the telemetry log already has the data.
- **Filesystem state-marker files (touch `<doc-id>.classifying`, `<doc-id>.embedding`)**: Reject: scattered file I/O (one create per state transition); harder to reverse-scan; doesn't survive process crash mid-write.
- **In-memory checkpoint with WAL**: Reject: in-memory state is lost on SIGKILL by definition; the in-memory checkpoint would need to be persisted, which is what the telemetry log already does.
- **Recovery via re-ingesting from `Paths.inbox()`**: Reject: doesn't handle classify/embed/index/edges-build orphans (those are post-ingest stages); only handles a subset.

**Source citations**:
- Constitution Principle XIII (Telemetry-or-Die)
- Constitution Principle X (Idempotent Pipeline Transitions)
- Constitution Principle IX (Concurrency-Safe Shared State)
- SP-001 telemetry-event surface (`packages/contracts/src/telemetry.ts`)
- SP-003 sentinel-row + drain-lock contract
- ARCHITECTURE-FINAL §6 (substrate read-path; telemetry is the second read-path alongside SQL)

---

## Decision B — Resumability matrix

**Decision**: Per-stage resumability per the matrix below. All idempotency claims trace to existing SP-003/004/005 atomic-write contracts (Constitution X verbatim).

| Stage | Resumable? | Rationale |
|---|---|---|
| `ingest.*` | Resumable IF inbox file present | Re-run SP-003 validation + hash + normalize + persist; idempotent because SP-003's persister deduplicates by hash. If inbox file is absent (operator removed it during the kill window), non-resumable. |
| `classify.*` | Resumable (always) | SP-004's `classifyStage` is idempotent — re-classifying an `facet_type='unclassified'` row produces the same classifier output OR routes the row to the failure lane with a documented `error_code`. The `AND facet_type='unclassified'` defense-in-depth UPDATE clause (FR-CLASSIFY-012) makes this safe. |
| `embed.*` | Resumable (always) | SP-005's embed-stage is idempotent — re-running on a row that has a `documents_vec` entry is a no-op per FR-RETRIEVAL-012's `WHERE NOT EXISTS` check; re-running on a row without one re-embeds the same body content with the same configured model (deterministic output). |
| `index.*` | Resumable (always) | SP-005's index-persister uses `INSERT OR IGNORE` for `documents_fts` + atomic `BEGIN/COMMIT` for the three-row transaction; partial state is forbidden (Constitution VIII). A kill mid-transaction rolls back to before any inserts. Re-running on already-indexed rows is a no-op. |
| `edges-build.*` | Resumable (always) | SP-005's edges-builder uses `INSERT OR IGNORE` per FR-RETRIEVAL-008; partially-inserted edges are preserved on re-run, unstarted edges are added. Idempotent. |

Non-resumable cases produce a `<doc-id>.recovery.error.json` sidecar at `Paths.failed()` with `error_code='unrecoverable_orphan'`, `stage=<stage>`, `message=<diagnostic>`, `timestamp=<scan-time>`, `retriable=false`.

**Rationale**:

- **Aligns with Constitution X**: Every stage's idempotency is already established at the atomic-write level. The recovery scanner doesn't introduce NEW idempotency claims — it relies on the existing SP-003/004/005 contracts.
- **Conservative on ingest**: The ingest stage is the only one where resumability depends on external state (the inbox file). If the operator removed it during the kill window, the recovery can't reconstruct it. This is honest and operator-driven.
- **Defensive on absent adapters**: If SP-004 has been removed from the daemon (e.g., a `classifyEnabled: false` configuration), the recovery scanner skips classify-stage orphans (would produce no re-queue effect). Documented as Anti-claim in the spec. SP-006 ships a defensive check: if the daemon's classify-hook is disabled, recovery for `classify.*` orphans is recorded but not actually re-queued.
- **Simple, deterministic, mechanical**: No human-in-the-loop. Every orphan has exactly one resolution path determined by its stage + external state.

**Alternatives considered**:

- **All-or-nothing recovery (any kill → full reindex)**: Reject — wasteful (re-classifies / re-embeds healthy rows); doesn't align with incremental idempotency contracts.
- **Manual operator-driven recovery (`corpus recover --doc-id=...`)**: Reject — defeats the trust model ("I drop files and the corpus quietly does the right thing"); the operator shouldn't need to know which docs are mid-pipeline.
- **Per-stage exponential-backoff retry**: Reject — overkill for a kill-9 recovery scenario; the underlying transitions are deterministic and either succeed on re-run or fail-clean.

**Source citations**:
- Constitution Principle X (Idempotent Pipeline Transitions)
- Constitution Principle VIII (Atomic Writes & Transactional Index Updates)
- SP-003 FR-INGEST-011 + failure-lane.ts contract
- SP-004 FR-CLASSIFY-012 defense-in-depth idempotency
- SP-005 FR-RETRIEVAL-008 INSERT OR IGNORE on edges
- SP-005 FR-RETRIEVAL-012 WHERE NOT EXISTS on index

---

## Decision C — Recovery scanner re-entrancy

**Decision**: The scanner is itself idempotent. Running it twice in succession produces the same orphan set + re-queues the same work; the re-queued work's underlying transitions are no-ops on second pass. The scanner records its own session boundaries via `recovery.scan_started` + `recovery.scan_completed` events. If the scan itself is killed mid-flight, the new daemon's scan detects the orphaned `recovery.scan_started` (no matching `recovery.scan_completed`) and emits `recovery.scan_reentry`.

**Rationale**:

- **Idempotency at every level**: Constitution X cascades from the per-stage transitions up to the recovery-scanner level. If the scan can be safely re-run, then a mid-scan kill is recoverable on the next daemon boot.
- **Self-bounded markers**: The scanner's own `*.started` / `*.completed` markers in the telemetry log allow the next scanner to detect re-entry without ambiguity.
- **No recursive recovery**: The `recovery.scan_reentry` event is fired ONCE per re-entry; the scanner proceeds with the current-session scan against the current-end-of-log boundary. There is no infinite-recursion risk.

**Alternatives considered**:

- **Lock-file-based one-shot recovery (write a `recovery.lock` at scan start; remove at completion; if present on boot, skip recovery)**: Reject — the lock-file approach is fragile (stale lock on kill); the telemetry-log approach is more robust because the markers ARE the recovery state.
- **Single-pass-only recovery (refuse to re-run)**: Reject — violates Constitution X; a partially-completed first pass would leave the corpus in a degraded state.

**Source citations**:
- Constitution Principle X
- Constitution Principle XIII (telemetry markers as recovery state)

---

## Decision D — Telemetry classes for recovery + tier fallthrough

**Decision**: SP-006 adds 13 new telemetry event classes to the `TelemetryEvent` discriminated union, plus updates the SP-005 `search.completed` event's `tier_used` field from `z.literal('hybrid')` to `z.enum([...])`. See data-model.md Entity 5 and Entity 4 for full schemas.

**Rationale**:

- **Constitution XIII (telemetry-or-die)**: Every state transition emits a structured event. Recovery and tier fallthrough are state transitions; they require event coverage.
- **9 recovery classes + 1 failures-resource class + 4 tier-fallthrough classes**: This is the minimal coverage that captures every observable recovery / failures-read / tier-cascade transition.
- **Additive to existing discriminated union**: No backward-compatibility breaks. Existing SP-001..SP-005 consumers continue to parse old events; SP-006 consumers parse new + old.

**Alternatives considered**:

- **One catch-all `recovery` event with a `subtype` field**: Reject — defeats Zod's discriminated-union type-safety; downstream consumers can't pattern-match exhaustively.
- **No new telemetry; surface recovery state in `corpus://manifest`**: Reject — adds mutation surface (manifest would need to be re-generated on each recovery); manifest is structural, not event-driven.

**Source citations**:
- Constitution Principle XIII
- SP-001 telemetry-event surface
- Constitution Principle V (schema-enforced output)

---

## Decision E — `corpus://failures` resource URI and pagination

**Decision**: Query parameters `?stage=<stage>&since=<ISO date>&limit=<int>&offset=<int>`. Defaults: stage=*, since=unbounded, limit=50, offset=0. Result shape `{entries: FailureEntry[], total_count: int, returned_count: int, schema_version: 1}`.

**Rationale**:

- **Mirrors SP-002 `corpus://recent` pattern**: The pagination semantics (limit/offset, total_count) align with the SP-002 read-only pattern.
- **Default limit=50 is conservative**: Most queries inspect recent failures, not the full backlog. A hard cap of limit=1000 prevents pathological huge reads.
- **`schema_version: 1` enables future evolution**: SP-007+ can ship `schema_version: 2` (e.g., adding a `severity` or `tags` field) without breaking SP-006-era readers.
- **Read-only by construction**: The resource handler is gated by `no-writes-from-resource-handlers` ESLint rule (SP-002-introduced; scoped to the new SP-006 handler too).

**Alternatives considered**:

- **No pagination (return all sidecars)**: Reject — pathological 10k-sidecar backlog would be a multi-second read.
- **Cursor-based pagination (return `next_cursor` instead of offset)**: Reject — overkill for v1; offset/limit is simpler and well-understood.
- **WebSocket-style streaming (send new failures as they happen)**: Reject — violates Constitution III (substrate, not surface; no event-driven mutation surfaces) and Constitution IV (single-user, single-machine; streaming implies long-lived connections).

**Source citations**:
- Constitution Principle III (Substrate, Not Surface)
- SP-002 `corpus://recent` pagination pattern
- SP-005 FR-RETRIEVAL-004 envelope pattern (validation_error)

---

## Decision F — Failures resource sidecar globbing and graceful degradation

**Decision**: The handler globs `Paths.failed() + '/*.error.json'` AND `Paths.failed() + '/*.recovery.error.json'` (both patterns). Each sidecar is read + JSON-parsed + Zod-validated against `FailureEntryZodSchema`. Malformed sidecars are SKIPPED from the response AND a `failures.sidecar_parse_failed` event is emitted with the sidecar's path. The remaining well-formed sidecars are returned. If `Paths.failed()` directory does not exist, the response is `{entries: [], total_count: 0, returned_count: 0, schema_version: 1}` (clean install case).

**Rationale**:

- **Per-sidecar graceful degradation**: A single malformed file shouldn't fail the whole read. Operator visibility is preserved via the `failures.sidecar_parse_failed` event.
- **Glob both patterns**: SP-003's `.error.json` + SP-006's `.recovery.error.json` are structurally identical (same JSON shape). The resource handler treats them uniformly.
- **Clean-install fast-path**: Empty directory is a valid state (clean install, no failures yet). Returns empty response gracefully, no error.

**Alternatives considered**:

- **Fail the whole read on any malformed sidecar**: Reject — operator would never see the other 99 failures if one bad file is present. Bad ergonomics.
- **Cache the parsed sidecars in memory and serve from cache**: Reject — sidecars can be manually rm'd by the operator; serving stale cache would lie. The disk is the source of truth.

**Source citations**:
- Constitution Principle XIII (telemetry-or-die — every error path emits an event)
- SP-003 failure-lane.ts on-disk shape

---

## Decision G — Tier fallthrough trigger threshold

**Decision**: Tier 0 returns < `[search].min_results` (default=3) → fall to Tier 1. Tier 1 still < min → Tier 2. Tier 2 still < min → Tier 3. Each tier inherits the caller's master AbortSignal; each tier's results are MERGED with prior tiers (deduplicated by `doc_id`) before the count is re-evaluated against `min_results`.

**Rationale**:

- **`min_results=3` aligns with the ARCHITECTURE-FINAL §10.6 spirit**: A query that returns 0-2 hits is likely under-served at the higher tier; falling through helps. A query that returns 3+ hits at Tier 0 is likely fine and shouldn't pay the fallthrough latency.
- **Configurable via `config.toml [search].min_results`**: Different deployments may tune. Default 3 is the spec'd value.
- **Merge + dedup preserves higher-tier ordering**: A doc found at both Tier 0 and Tier 1 retains its Tier 0 score and `tier_used: 'hybrid'` label (higher tier wins).

**Alternatives considered**:

- **Single threshold `min_results=0` (only fall through on empty)**: Reject — leaves cases where Tier 0 returns 1-2 borderline hits unserved by lower tiers.
- **Per-tier threshold (`tier0_min_results=3, tier1_min_results=5, ...`)**: Reject — additional config knobs without clear practitioner-grade rationale.
- **Quality-weighted fallthrough (fall through if Tier 0's hits' average score < threshold)**: Reject — scores are not normalized across retrievers (RRF k=60 fusion produces small-magnitude scores); thresholding is fragile.

**Source citations**:
- ARCHITECTURE-FINAL §10.6 verbatim
- Constitution Principle XVI (validation honesty — threshold is configurable, not magic)
- SP-005 FR-RETRIEVAL-002 four-signal hybrid retriever

---

## Decision H — Tier 2 (CATALOG.md grep) implementation

**Decision**: CATALOG.md lives at `Paths.data() + '/CATALOG.md'`. One line per indexed document: `<doc-id> | <title> | <facet_domain> | <facet_type> | <summary-first-200-chars>`. Generated at SP-005 index-stage time (post-COMMIT of the SP-005 SQL transaction) via additive extension to `packages/storage/src/index-persister.ts`. Regenerated wholesale by `corpus reindex` (SP-006-extended). Tier 2's grep is IN-PROCESS (read file into memory; substring-match each line against the query terms; map matching lines to doc_ids). If CATALOG.md is absent, Tier 2 emits `search.tier_skipped` with `reason='catalog_missing'` and falls through to Tier 3.

**Rationale**:

- **Flat-file mirror, not SQL**: CATALOG.md is a Tier 2 INPUT, not a corpus surface. Generating it as a flat file allows operator `cat` access and avoids growing the SQL schema. Lives at `Paths.data() + '/CATALOG.md'` (XDG-compliant).
- **In-process grep is fastest**: At ~200 chars/line × 10000 docs = ~2 MB file. Reading + scanning is < 50 ms on commodity hardware. No subprocess.
- **Append-at-index-time is the cheap path**: A single line append (~1 ms) is negligible alongside the SP-005 index transaction. Atomic via `withTempDir + fs.appendFile`.
- **Graceful skip on legacy DBs**: Pre-SP-006 corpora don't have CATALOG.md. Tier 2 skips and Tier 3 still works.

**Alternatives considered**:

- **Tier 2 reads SP-005's `documents` table directly (in-process SQL query)**: Reject — duplicates Tier 0/1's BM25 surface; doesn't provide a separate degradation path.
- **External catalog tool (e.g., `ack` or `ripgrep`)**: Reject — adds a subprocess dependency for Tier 2 when in-process grep suffices.
- **CATALOG.md generated at daemon-startup-time instead of index-stage-time**: Reject — would re-scan the whole `documents` table on every daemon boot; index-stage append is incremental and cheap.

**Source citations**:
- ARCHITECTURE-FINAL §10.6 (Tier 2 = CATALOG body grep)
- Constitution Principle XII (subprocess hygiene — avoid unnecessary subprocesses)
- Constitution Principle XIV (XDG paths)
- SP-004 body-file frontmatter rewrite pattern (flat-file mirror outside SQL transaction)

---

## Decision I — Tier 3 (fs-grep) subprocess invocation

**Decision**: Tier 3 invokes `runTool('grep', ['-rn', '-l', '--include=*.md', <pattern>, Paths.docs()], {signal, timeoutMs})`. The `<pattern>` is the query string escaped for grep BRE (backslash-escape `[]\^$.|*+()?{}`). The path is a literal `Paths.docs()` value (no shell expansion). The returned file paths are mapped to `doc_id` via the `documents.body_path` reverse lookup (single SQL query `SELECT id FROM documents WHERE body_path = ?`).

**Rationale**:

- **Constitution XII subprocess hygiene**: `runTool` with arg array; no string-formed shell command. Args are array-passed.
- **`-l` flag returns file paths only**: Reduces parsing overhead; the orchestrator caps results at `policy.topKPerRetriever` (default 64).
- **`--include=*.md` scopes to body files**: Avoids matching `.error.json`, `*.recovery.error.json`, `CATALOG.md`, etc.
- **Path → doc_id reverse mapping is the necessary bridge**: Tier 3 produces matched file paths; the SearchHit shape requires `uri: corpus://docs/<doc-id>`. The `documents.body_path` lookup is single-row SQL.
- **`signal` propagation**: AbortController fires → grep subprocess receives SIGTERM (via `runTool`'s child-process kill); within Constitution VII 2-second budget.

**Alternatives considered**:

- **In-process recursive `fs.readFile` + JavaScript regex over each body**: Reject — much slower than native grep on large corpora; would push Tier 3 latency well over the §10.6 < 500 ms target.
- **`ripgrep` (rg) instead of `grep`**: Reject — adds a new dependency; `grep` is POSIX-baseline and present on every supported platform. Future ADR may reconsider.
- **Sharded fs-grep via worker threads**: Reject — overkill for v1; single subprocess invocation is bounded by latency budget.

**Source citations**:
- ARCHITECTURE-FINAL §10.6 (Tier 3 = fs-grep)
- Constitution Principle XII (subprocess hygiene)
- Constitution Principle VII (cancellable IO)
- Existing SP-001 `runTool` helper

---

## Decision J — Aggregate latency budget for tier cascade

**Decision**: Configurable via `config.toml [search].tier_total_budget_ms`. Default: 600 ms (= 20 ms Tier 0 + 5 ms Tier 1 + 50 ms Tier 2 + 500 ms Tier 3 + 25 ms slack). Enforced via AbortController wired to `setTimeout(() => controller.abort('tier_budget_exceeded'), budget_ms)` AND `clearTimeout` on cascade completion. Per-tier targets per §10.6 are TARGETS not guarantees (Constitution XVI honesty).

**Rationale**:

- **§10.6 verbatim**: "A query returning fewer than `min_results` hits at tier 0 falls through to lower tiers within an aggregate latency budget."
- **AbortController + setTimeout/clearTimeout is the Constitution VII pattern**: Never `Promise.race(setTimeout)`.
- **Per-tier targets sum + slack**: The 600 ms default reflects the §10.6 per-tier targets; the 25 ms slack accommodates orchestration overhead.
- **Honest commitments at 5x aspirational ceilings**: Per Constitution XVI; empirical p95 measured at impl time, recorded in plan.md.

**Alternatives considered**:

- **Per-tier deadline (each tier gets its own timeout independently)**: Reject — risks one slow tier eating the others' budget; the aggregate budget is the right grain.
- **No budget (run all tiers always)**: Reject — pathological cases (e.g., huge corpus + slow disk) would produce multi-second queries.
- **Adaptive budget (tune per query length)**: Reject — overkill for v1; static budget is the practitioner-grade default.

**Source citations**:
- ARCHITECTURE-FINAL §10.6 verbatim
- Constitution Principle VII (Cancellable, Bounded IO)
- Constitution Principle XVI (Validation Honesty)

---

## Decision K — `tier_used` field on SearchHit

**Decision**: Add a new REQUIRED field `tier_used: z.enum(['hybrid','bm25-only','catalog-grep','fs-grep'])` to `SearchHitZodSchema`. Per-hit `tier_used` reflects the tier that produced the hit. The cascade-level `search.completed` event's `tier_used` reflects the DEEPEST tier that contributed any hit. SP-005's hardcoded `'hybrid'` literal is updated to the enum.

**Rationale**:

- **ARCHITECTURE-FINAL §10.6 verbatim**: "the matched tier is reported in hit metadata."
- **Additive in the enum-domain sense**: Existing SP-005 consumers that strict-parse SearchHit will receive the new field and (if they don't enumerate it) ignore it. Strict Zod parsers in the substrate's own packages parse the new enum correctly.
- **Per-hit granularity preserves provenance**: Operator / agent can audit which tier produced which hit (e.g., "the top 3 hits are hybrid, the next 2 are bm25-only — Tier 0 underdelivered").

**Alternatives considered**:

- **Cascade-level `tier_used` only (not per-hit)**: Reject — loses provenance; can't distinguish Tier 0 hits from Tier 1 hits in a merged response.
- **Numeric `tier: 0|1|2|3`**: Reject — less readable; enum is more self-documenting.

**Source citations**:
- ARCHITECTURE-FINAL §10.6 verbatim ("matched tier is reported in hit metadata")
- Constitution Principle V (schema-enforced structured output)

---

## Decision L — CATALOG.md write timing

**Decision**: Append to `Paths.data() + '/CATALOG.md'` AFTER the SP-005 SQL transaction commits (post-COMMIT). NOT inside the SP-005 atomic-index transaction. Atomic via `withTempDir + fs.appendFile`; partial writes are forbidden permitted state.

**Rationale**:

- **Constitution VIII transactional unit is the SQL writes**: The SP-005 transaction wraps `INSERT documents_fts + INSERT documents_vec + INSERT edges`. CATALOG.md is a flat-file mirror, NOT a SQL write. Mirrors the SP-004 body-file frontmatter pattern (write the SQL row first; then mirror to body-file frontmatter via COMMIT-then-rename).
- **Post-COMMIT atomicity is sufficient**: If the daemon dies between SQL COMMIT and CATALOG.md append, the row is indexed but missing from CATALOG.md. Tier 0 / Tier 1 / Tier 3 still serve it. Tier 2 misses it. Recovery scanner detects this if `catalog.append.started` exists without `catalog.append.completed` (added telemetry).
- **`corpus reindex` is the regeneration path**: Operator can run `corpus reindex` to rebuild CATALOG.md from scratch. SP-006 extends the reindex CLI to do this additively.

**Alternatives considered**:

- **Include CATALOG.md append INSIDE the SP-005 transaction**: Reject — SQL transactions can't atomically include flat-file writes; would couple Constitution VIII to filesystem semantics.
- **Background batch-regeneration of CATALOG.md (every N minutes)**: Reject — adds a background timer (Constitution III complications); the per-index append is incremental.

**Source citations**:
- Constitution Principle VIII (Atomic Writes & Transactional Index Updates)
- SP-004 body-file frontmatter rewrite pattern
- SP-005 FR-RETRIEVAL-007

---

## Decision M — Recovery scan policy choice (batch vs interactive)

**Decision**: Recovery scan uses `batchPolicy`. The re-queued sub-stages also use `batchPolicy` (since the daemon's normal post-classify hook chain uses batch).

**Rationale**:

- **Recovery is non-interactive**: The user is not waiting at a terminal for the scan to finish; the daemon is starting up. Batch is the right policy.
- **Consistent with daemon hook chain**: The daemon's normal post-classify chain uses batch policy. Recovery re-queues into the same chain; using batch is congruent.

**Alternatives considered**:

- **Interactive policy (faster timeouts)**: Reject — recovery may need to re-classify many documents; interactive timeouts are aggressive.

**Source citations**:
- Constitution Principle VI (One Pipeline, Two Policies)
- SP-003 / SP-004 / SP-005 policy conventions

---

## Decision N — Recovery sidecar uniqueness

**Decision**: `<doc-id>.recovery.error.json` filenames use the doc_id as the discriminator. If a doc has both a regular `.error.json` (from SP-003) AND a `.recovery.error.json` (from SP-006), both are returned by the `corpus://failures` resource handler (uniqueness is per-file, not per-doc).

**Rationale**:

- **Distinguishes pipeline-failure vs recovery-failure events**: An operator triaging failures can see "doc-1234 failed during ingest, then failed recovery". Both contribute to the failure picture.
- **Glob pattern handles both**: `Paths.failed() + '/*.error.json'` matches `.error.json` AND `.recovery.error.json` (the latter is a longer suffix; `*.error.json` matches both).

**Alternatives considered**:

- **Replace `.error.json` with `.recovery.error.json` on recovery (delete + write)**: Reject — loses the original failure context.
- **Append to existing `.error.json` (JSONL within the file)**: Reject — breaks the SP-003 single-object schema; would need a schema bump.

**Source citations**:
- SP-003 failure-lane.ts sidecar shape
- Constitution V (schema-enforced output)

---

## Anti-decisions (explicitly NOT undertaken)

- **No `corpus failures clear` CLI subcommand** — out of scope per spec.md. Operator manually rm's sidecars after triaging.
- **No `corpus failures retry --doc-id=X` CLI** — out of scope. Operator manually re-ingests via inbox drop.
- **No recovery for SQLite-file corruption** — out of scope. SP-006 recovery scope is process kills only.
- **No automatic CATALOG.md backfill for legacy corpora** — partial scope. New ingests get CATALOG.md auto-generated; legacy corpora that don't run `corpus reindex` get graceful Tier 2 skip + Tier 3 fallthrough.
- **No Tier 4+** — §10.6 four-tier model is the architectural ceiling.
- **No cross-corpus federation** — Constitution IV.
- **No worker-pool parallelism for tier cascade** — sequential cascade by design (each tier is a gated fallthrough).
- **No retrieval-eval harness** — Constitution XVI / NFR-009; deferred to v1.5+.
- **No new MCP mutation surfaces** — Constitution III; `corpus://failures` is read-only by construction.

---

## Summary

SP-006's 14 decisions resolve all SP-006 v1 design space. The recovery scanner uses Constitution XIII telemetry as its state source. The `corpus://failures` resource mirrors SP-002's read-only resource pattern. The tier-fallthrough cascade implements §10.6 verbatim with honest Constitution XVI commitments. All three deliverables are read-only / idempotent / drain-lock-serialized; ZERO new MCP mutation surfaces; ZERO new SQL tables; ZERO new XDG bases. The SP-005 SearchHit shape is extended additively. The SP-003 sidecar shape is consumed read-only. The substrate ships install-complete after SP-006 merge.
