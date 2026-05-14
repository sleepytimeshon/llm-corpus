# Quickstart — SP-006 Production Hardening Operator Walkthrough

**Feature**: 006-hardening
**Date**: 2026-05-13

This document walks the operator through the three SP-006 deliverables on the user's pai-node01 Fedora workstation. It assumes the SP-001..SP-005 baseline is installed and running.

## Operator prereqs

- SP-001..SP-005 merged on `main`; the corpus binary is installed (`which corpus` returns a path).
- `Paths.docs()`, `Paths.failed()`, `Paths.inbox()`, `Paths.telemetry()`, `Paths.drainLock()`, `Paths.data()` resolvable via `corpus paths`.
- `ollama` service running with `qwen3.5:9b` (or `gemma3:4b`) loaded for the SP-004 classifier AND `nomic-embed-text` loaded for the SP-005 embedding adapter.
- `grep --version` returns a POSIX-compatible grep binary on PATH.
- A seeded inbox with mixed-MIME documents available for the kill-9 sim (PDFs, Markdown, plain-text, HTML).

### Prereq verification log (T001, 2026-05-13)

- `command -v grep` → resolvable (binary on PATH).
- `/usr/bin/grep --version` → `grep (GNU grep) 3.12` (POSIX-compatible).
- SP-001..SP-005 merge commits on `main`: 791e8aa (SP-001), f36a074/6232f2b/8bd09c7 (SP-002), 74a0370 (SP-003), 33f233c (SP-004), 7592eb9 (SP-005). SP-005 head commit: 7592eb9.
- All required `Paths.*` getters present in `packages/contracts/src/paths.ts`: `data`, `telemetry`, `drainLock`, `docs`, `inbox`, `failed`.
- Node v22.22.0, npm 10.9.4, gh CLI authenticated as `sleepytimeshon`.

## Walkthrough 1 — Simulate kill-9 mid-classify and observe recovery

**Goal**: Demonstrate that the daemon survives a SIGKILL mid-classify and recovers orphan work on restart.

### Step 1: Start the daemon

```bash
corpus daemon &
DAEMON_PID=$!
```

Observe stderr output: `[corpus] daemon started, pid=$DAEMON_PID`. The daemon emits a `daemon.started` telemetry event.

### Step 2: Drop fixture files into the inbox

```bash
cp ~/Projects/llm-corpus/tests/fixtures/sp006-hardening/sample-docs/*.md $(corpus paths inbox)/
```

Observe stderr output: `[corpus] ingest started for <N> files`. Each file enters the SP-003 → SP-004 → SP-005 four-sub-stage pipeline (ingest → classify → embed → index → edges-build).

### Step 3: Kill the daemon mid-classify

Wait ~2 seconds (long enough for ingest to complete but classify still in flight), then:

```bash
kill -9 $DAEMON_PID
```

The daemon process is terminated immediately. NO `finally` blocks ran, NO AbortSignal cleanup, NO graceful shutdown.

### Step 4: Verify the orphaned state in telemetry

```bash
tail -20 $(corpus paths telemetry) | jq -r 'select(.event | startswith("classify."))'
```

Observe: some `classify.started` events without matching `classify.completed` — these are the orphans.

### Step 5: Restart the daemon

```bash
corpus daemon &
NEW_DAEMON_PID=$!
```

Observe stderr output:

```
[corpus] daemon starting
[corpus] runRecoveryScan acquired drain-lock
[corpus] recovery.scan_started — scanning telemetry from end-of-file
[corpus] recovery.orphan_found doc_id=doc-XXXXXXXX stage=classify
[corpus] recovery.orphan_found doc_id=doc-YYYYYYYY stage=classify
[corpus] recovery.resumed doc_id=doc-XXXXXXXX stage=classify
[corpus] recovery.resumed doc_id=doc-YYYYYYYY stage=classify
[corpus] recovery.scan_completed resumed=2 aborted=0 duration_ms=N
[corpus] runRecoveryScan released drain-lock
[corpus] daemon started, pid=$NEW_DAEMON_PID
```

### Step 6: Verify the recovery completed

After the per-doc four-sub-stage budget elapses (~30s on warm Ollama):

```bash
sqlite3 $(corpus paths index-db) "SELECT id, facet_type, (SELECT COUNT(*) FROM documents_vec WHERE doc_id=documents.id) AS has_vec FROM documents ORDER BY ingest_timestamp DESC LIMIT 10"
```

Observe: every row has `facet_type != 'unclassified'` AND `has_vec = 1`. Recovery succeeded.

### Step 7: Check for non-resumable orphan sidecars

```bash
ls -la $(corpus paths failed)/*.recovery.error.json 2>/dev/null
```

If a file shows up, view it:

```bash
cat $(corpus paths failed)/<doc-id>.recovery.error.json | jq .
```

Expected shape (rare — only if the inbox file was deleted during the kill window):

```json
{
  "doc_id": "doc-XXXXXXXX",
  "stage": "ingest",
  "error_code": "unrecoverable_orphan",
  "message": "ingest file missing from Paths.inbox()",
  "timestamp": "2026-05-13T...",
  "retriable": false
}
```

---

## Walkthrough 2 — Read `corpus://failures` via MCP

**Goal**: Demonstrate that the agent can inspect the failure backlog through the MCP read surface.

### Step 1: Seed a fixture sidecar (if needed)

If you don't have any `<doc-id>.error.json` sidecars at `Paths.failed()` from the recovery sim, create one manually:

```bash
mkdir -p $(corpus paths failed)
cat > $(corpus paths failed)/doc-deadbeef.error.json <<'EOF'
{
  "doc_id": "doc-deadbeef",
  "stage": "classify",
  "error_code": "classify_schema_invalid",
  "message": "LLM response failed Zod validation",
  "timestamp": "2026-05-13T10:00:00Z",
  "retriable": true
}
EOF
```

### Step 2: Start the MCP server

```bash
corpus mcp-server &
MCP_PID=$!
```

### Step 3: Read `corpus://failures` via MCP client

Using `mcptool` (or any MCP-aware client):

```bash
mcptool read corpus://failures
```

Expected response (JSON):

```json
{
  "entries": [
    {
      "doc_id": "doc-deadbeef",
      "stage": "classify",
      "error_code": "classify_schema_invalid",
      "message": "LLM response failed Zod validation",
      "timestamp": "2026-05-13T10:00:00Z",
      "retriable": true,
      "sidecar_path": "/home/shonrs/.local/share/llm-corpus/failed/doc-deadbeef.error.json"
    }
  ],
  "total_count": 1,
  "returned_count": 1,
  "schema_version": 1
}
```

### Step 4: Filter by stage

```bash
mcptool read 'corpus://failures?stage=embed'
```

Expected: entries where `stage='embed'`. If there are none, `entries: [], total_count: 0`.

### Step 5: Paginate

```bash
mcptool read 'corpus://failures?limit=5&offset=10'
```

Expected: entries 11-15 (if you have ≥ 15 sidecars), else fewer.

### Step 6: Try an invalid query

```bash
mcptool read 'corpus://failures?stage=invalid_stage_name'
```

Expected: a successful MCP resource response carrying:

```json
{
  "error_code": "validation_error",
  "message": "stage must be one of: validation, hash, normalize, persist, classify, embed, index, edges-build, unrecoverable_orphan",
  "hint": "Pass a valid stage or omit the parameter."
}
```

(NOT a JSON-RPC transport error.)

### Step 7: Triage and clean up

After the operator fixes the underlying issue (e.g., re-ingests the document):

```bash
rm $(corpus paths failed)/doc-deadbeef.error.json
```

Re-read `corpus://failures` to confirm the entry is gone.

---

## Walkthrough 3 — Force Tier 0 to return empty and observe fallthrough

**Goal**: Demonstrate the Tier 0 → Tier 1 → Tier 2 → Tier 3 cascade.

### Step 1: Verify the baseline (Tier 0 hybrid is working)

```bash
mcptool call corpus.find '{"query": "vector database retrieval"}'
```

Observe a SearchHit list. Inspect:

```bash
mcptool call corpus.find '{"query": "vector database retrieval"}' | jq '.hits[].tier_used'
```

Expected: every hit has `tier_used: "hybrid"`. `search.completed` telemetry has `tier_used: 'hybrid'`.

### Step 2: Force Tier 0 to return < min_results (delete documents_vec)

```bash
sqlite3 $(corpus paths index-db) "DELETE FROM documents_vec"
```

Now Tier 0's dense-vector retriever returns zero hits (but BM25 still works). The cascade should fall through to Tier 1.

```bash
mcptool call corpus.find '{"query": "rare-term-not-embedded"}' | jq '.hits[].tier_used'
```

Expected: a mix of `"hybrid"` (Tier 0 BM25-only hits — yes, Tier 0's BM25 retriever still runs) and `"bm25-only"` (Tier 1 hits). Inspect telemetry:

```bash
tail -5 $(corpus paths telemetry) | jq -r 'select(.event == "search.tier_fallthrough")'
```

Expected:

```json
{"event":"search.tier_fallthrough","from_tier":"hybrid","to_tier":"bm25-only","reason":"below_min_results","hits_before_fallthrough":N}
```

### Step 3: Force Tier 1 to also return empty (delete documents_fts)

```bash
sqlite3 $(corpus paths index-db) "DELETE FROM documents_fts"
```

Now Tier 0 + Tier 1 both return zero hits. Tier 2 (CATALOG.md grep) should fire.

```bash
mcptool call corpus.find '{"query": "<term that appears in a CATALOG.md summary>"}' | jq '.hits[].tier_used'
```

Expected: hits with `tier_used: "catalog-grep"` if CATALOG.md exists.

### Step 4: Force Tier 2 to be skipped (remove CATALOG.md)

```bash
mv $(corpus paths data)/CATALOG.md /tmp/CATALOG.md.bak
```

Now Tier 0 + Tier 1 + Tier 2 all return zero hits. Tier 3 (fs-grep) should fire.

```bash
mcptool call corpus.find '{"query": "<term that appears in a body file>"}' | jq '.hits[].tier_used'
```

Expected: hits with `tier_used: "fs-grep"`. Inspect telemetry:

```bash
tail -10 $(corpus paths telemetry) | jq -r 'select(.event | startswith("search.tier_"))'
```

Expected sequence:

```
search.tier_fallthrough (from=hybrid to=bm25-only)
search.tier_fallthrough (from=bm25-only to=catalog-grep)
search.tier_skipped (tier=catalog-grep, reason=catalog_missing)
search.tier_fallthrough (from=catalog-grep to=fs-grep)
```

Also verify the runTool invocation:

```bash
tail -5 $(corpus paths telemetry) | jq -r 'select(.event == "subprocess.invocation") | .tool'
```

Expected: at least one invocation of `grep`.

### Step 5: Restore the baseline

```bash
mv /tmp/CATALOG.md.bak $(corpus paths data)/CATALOG.md
corpus reindex
```

`corpus reindex` regenerates `documents_fts`, `documents_vec`, `edges`, AND CATALOG.md from scratch. After completion:

```bash
mcptool call corpus.find '{"query": "vector database retrieval"}' | jq '.hits[].tier_used'
```

Expected: every hit back to `tier_used: "hybrid"`.

---

## Walkthrough 4 — Exhaust the aggregate latency budget

**Goal**: Demonstrate that the AbortController fires and a partial response is returned.

### Step 1: Set an aggressive budget

Edit `~/.config/llm-corpus/config.toml`:

```toml
[search]
tier_total_budget_ms = 50
```

This is well below the §10.6 Tier 3 target alone.

### Step 2: Force all four tiers to fire (per Walkthrough 3 Step 4)

```bash
sqlite3 $(corpus paths index-db) "DELETE FROM documents_vec; DELETE FROM documents_fts"
mv $(corpus paths data)/CATALOG.md /tmp/CATALOG.md.bak
```

### Step 3: Invoke `corpus.find`

```bash
mcptool call corpus.find '{"query": "rare-term-not-embedded"}' | jq '.'
```

Expected: a successful response with a partial set of hits (possibly empty) and a `search.tier_budget_exceeded` telemetry event:

```bash
tail -5 $(corpus paths telemetry) | jq -r 'select(.event == "search.tier_budget_exceeded")'
```

Expected:

```json
{
  "event": "search.tier_budget_exceeded",
  "budget_ms": 50,
  "actual_ms": 5X,
  "tiers_attempted": ["hybrid","bm25-only","catalog-grep","fs-grep"],
  "final_hit_count": 0
}
```

### Step 4: Restore baseline

```bash
# Reset config
$EDITOR ~/.config/llm-corpus/config.toml  # remove the tier_total_budget_ms override
mv /tmp/CATALOG.md.bak $(corpus paths data)/CATALOG.md
corpus reindex
```

---

## Walkthrough 5 — Concurrent CLI during recovery (lock contention)

**Goal**: Demonstrate that the recovery scanner serializes via `Paths.drainLock()`.

### Step 1: Set up a long recovery

Drop many files into the inbox + kill the daemon mid-pipeline (per Walkthrough 1 Steps 1-3) but with a much larger batch (~100 files) so the recovery scan takes several seconds.

### Step 2: Restart the daemon

```bash
corpus daemon &
DAEMON_PID=$!
```

### Step 3: While recovery is running, attempt a CLI invocation

```bash
corpus reindex
```

Expected output:

```
[corpus] pipeline.lock_contention — drain-lock held by recovery scanner
[corpus] exiting cleanly (exit code 0)
```

Then in the recovery telemetry:

```bash
tail -5 $(corpus paths telemetry) | jq -r 'select(.event == "pipeline.lock_contention")'
```

Expected entry with `from='corpus reindex'`.

---

## What's NOT working yet (deferred to future sprints)

- **`corpus failures clear --stage=X`**: Operator manually `rm`s sidecars after triaging. Future CLI surface for bulk-clear.
- **`corpus failures retry --doc-id=X`**: Operator manually re-ingests via inbox drop. Future CLI surface for one-shot retry.
- **Recovery from SQLite-file corruption**: SP-006 scope is process kills only. SQLite corruption is a v1.5+ concern.
- **CATALOG.md sharding for huge corpora (1M+ docs)**: Future-horizon when needed.
- **Tier 4+ retrievers**: §10.6 four-tier model is the architectural ceiling.
- **Retrieval-evaluation harness** (NDCG, MRR, recall@K): Deferred to v1.5+ per Constitution XVI / NFR-009.

## Honest performance notes

The per-tier latency budgets per §10.6 are TARGETS, not guarantees. Empirical p95 on pai-node01 (measured post-implementation at Phase 7):

- Tier 0 (hybrid): TBD (inherits from SP-005 measurement)
- Tier 1 (BM25-only): TBD
- Tier 2 (CATALOG.md grep): TBD
- Tier 3 (fs-grep): TBD
- Recovery scan p95: TBD
- `corpus://failures` read p95 (100-sidecar backlog): TBD

These numbers are reported in `specs/006-hardening/plan.md` "Performance Goals" footnote after `tests/integration/tier-fallthrough-end-to-end.test.ts` runs.
