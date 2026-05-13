# SP-005 Quickstart — Operator Walkthrough

**Goal:** verify the hybrid-retrieval pipeline end-to-end on your machine after SP-005 lands.

## Prerequisites

```bash
# Ollama running with two models — generative (for classifier) + embedding (for SP-005)
ollama list
# Expected:
#   qwen3.5:9b           (or gemma3:4b)      — used by SP-004 classifier
#   nomic-embed-text     (768-dim local)     — used by SP-005 embedding

# If nomic-embed-text isn't loaded:
ollama pull nomic-embed-text
```

Verify the embedding endpoint:

```bash
curl -s http://localhost:11434/api/embeddings \
  -d '{"model": "nomic-embed-text", "prompt": "test"}' | head -c 80
# Expected: {"embedding":[0.665,..., ...]}
```

## 1. Clean rebuild

```bash
cd ~/Projects/llm-corpus
npm run build && npm run lint && npm run test
# All green; SP-005 sub-suite passes.
```

## 2. Initialize an isolated corpus

```bash
export CORPUS_HOME="$(mktemp -d -t sp005-walkthrough-XXXX)"
node packages/cli/dist/index.js init
ls "$CORPUS_HOME/data/docs/" "$CORPUS_HOME/data/inbox/"
```

The schema migration auto-creates the new `documents_fts` (FTS5), `documents_vec` (vec0), and `edges` tables alongside the existing `documents` + `taxonomy_terms` tables.

## 3. Drop a sample document

```bash
cat > "$CORPUS_HOME/data/inbox/sample.md" <<'EOF'
---
title: "Memory architectures for AI agents"
---
Agent memory is best modeled as four distinct stores: working memory, episodic,
semantic, and procedural. Each has different access patterns and lifetime.
EOF
```

## 4. Run the daemon for one drain cycle

```bash
node packages/cli/dist/index.js daemon --once 2>&1 | tee drain.log
```

Observe the pipeline stages in `drain.log`:
- `inbox.allowlist_hit` (SP-003 validation gate)
- `ingest.completed` (SP-003 persist)
- `classify.completed` (SP-004 classifier)
- `embed.completed` (SP-005 embedding)
- `index.completed` (SP-005 FTS5 + vec + edges write)

## 5. Run a search

```bash
node packages/cli/dist/index.js find "agent memory architecture"
```

Expected output (JSON): one SearchHit with `uri: corpus://docs/<id>`, score, and snippet. The `ranking_debug` field shows per-signal scores (BM25, vector, graph, confidence).

## 6. Test the four-signal degradation

```bash
# Stop Ollama; the embedding service is unavailable.
pkill -f 'ollama serve'

# Re-run search. Per FR-003 ACS#2, dense-vector signal failure does NOT silently
# disable ranking — the result set is still returned with degraded signal coverage,
# and telemetry emits a `search.degraded` event.
node packages/cli/dist/index.js find "agent memory"
```

Expected: hits still return (BM25 + graph + confidence cover the query); `ranking_debug.signals_used` reflects the missing dense signal.

## 7. Manual reindex backfill

```bash
ollama serve &   # restart Ollama
node packages/cli/dist/index.js reindex --dry-run
# Lists docs that would be re-embedded + re-indexed (none, if step 4 completed cleanly).

node packages/cli/dist/index.js reindex
# Drains backlog (none expected unless schema-version bumped or model changed).
```

## 8. Inspect telemetry

```bash
tail -50 "$CORPUS_HOME/state/telemetry.jsonl" | jq 'select(.event | startswith("search."))'
```

Each `search.completed` event includes `tier_used: 0` (Tier 0 hybrid; Tier 1/2/3 fallthrough is SP-006 scope), `result_count`, and per-signal contribution.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `vec_version()` unknown | sqlite-vec native addon not loaded | `npm run verify:native-addons` should pass; reinstall if not |
| Embedding HTTP 404 | `nomic-embed-text` not pulled | `ollama pull nomic-embed-text` |
| `documents_fts` table missing | Schema migration didn't run | Delete `$CORPUS_HOME/state/index.db` and re-run `init` |
| Search returns 0 hits but docs are classified | Embedding stage failed; check telemetry for `embed.failed` | Confirm Ollama is up; run `corpus reindex` |
