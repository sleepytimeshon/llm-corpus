# Phase 1 — Quickstart: SP-004 Classifier Operator Walkthrough

**Feature**: 004-classifier
**Date**: 2026-05-13
**Audience**: operator (Shon, single-user). Walks through the end-to-end SP-004 flow against the user's primary machine.

This quickstart is the **honest verification recipe** for the SP-004 spec. Each section is partitioned into:
- **Live verification** — runs against the user's actual `Paths.*` on the primary machine with Ollama loaded; this is the canonical SP-004 verification surface.
- **Fixture-driven verification** — runs via the SP-004 integration-test fixtures with mock-Ollama responses; used for failure-injection cases (schema-invalid, vocabulary-violation, mid-transaction failure).

Constitution XVI honesty: end-to-end SCs verify live; corner-case SCs verify via fixtures. Both partitions are listed.

---

## Prerequisites

- SP-001 merged on `main` (egress hook + MCP server foundation).
- SP-002 merged on `main` (resource layer + empty-baseline schema migration).
- SP-003 merged on `main` (ingest pipeline; sentinel-row contract).
- SP-004 implementation complete (`/speckit-implement` finished + all tests green).
- Node.js 20 LTS or 22 LTS installed.
- The corpus npm package built (`npm run build` at the monorepo root).
- `Paths.*` resolves under the user's actual XDG dirs (no `CORPUS_HOME` override needed for live verification — fixtures use a per-test override).
- **Ollama 0.5+ installed and running locally** at `http://localhost:11434` (verified via `curl http://localhost:11434/api/version`).
- **The configured model is loaded locally** (`ollama list` shows `qwen3.5:9b` by default; switch to `gemma3:4b` via `config.toml` `[classifier].model = "gemma3:4b"` if qwen3.5 is too slow on the user's hardware).

### Operator prereqs — verified at SP-004 implementation start (pai-node01, 2026-05-13)

T001 baseline check executed against the user's primary machine before implementation began:

```text
$ curl -fsS http://localhost:11434/api/version
{"version":"0.21.0"}

$ curl -fsS http://localhost:11434/api/tags | jq '.models[].name'
"qwen3.5:9b"
"gemma3:4b"
"qwen3:8b"
```

Verified facts (R1 mitigation per plan.md Risk Register):
- Ollama version 0.21.0 is >> 0.5, so the structured-outputs `format` parameter is supported.
- Primary model `qwen3.5:9b` (Q4_K_M, ~6.5 GB on disk) is locally available.
- Fallback model `gemma3:4b` (Q4_K_M, ~3.3 GB on disk) is locally available.
- `qwen3:8b` is also present (Decision A's secondary-fallback candidate).

---

## Live verification — autonomous classification on ingest (SC-CLASSIFY-001, SC-CLASSIFY-005)

This is the load-bearing happy-path verification. Walks the entire SP-003 → SP-004 surface against real files on the primary machine with the daemon running.

### Step 1 — Initialize the corpus + seed minimal taxonomy

```bash
corpus init

# Seed a minimal established taxonomy (post-SP-006 will offer a CLI subcommand;
# for SP-004 the user manually seeds via SQL or via a script):
sqlite3 $(corpus path index-db) << 'EOF'
INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
  ('domain', 'agent-systems', 'established', datetime('now')),
  ('domain', 'distributed-systems', 'established', datetime('now')),
  ('domain', 'machine-learning', 'established', datetime('now')),
  ('tag', 'retrieval', 'established', datetime('now')),
  ('tag', 'memory', 'established', datetime('now')),
  ('tag', 'tutorial', 'established', datetime('now')),
  ('tag', 'paper', 'established', datetime('now')),
  ('tag', 'reference', 'established', datetime('now'))
ON CONFLICT(axis, term) DO NOTHING;
EOF
```

Expected:
- All SP-003-era paths created (`Paths.inbox()`, `Paths.pending()`, `Paths.processed()`, `Paths.failed()`, `Paths.docsStore()`, `Paths.indexDb()`).
- `taxonomy_terms` now contains 3 established domains + 5 established tags.
- `corpus://taxonomy` MCP read (via any MCP client) returns these 3 + 5 in the `established_domains` / `established_tags` arrays.

### Step 2 — Start the SP-003 daemon (which now invokes SP-004 classify-stage post-persist)

```bash
corpus daemon start
```

Expected:
- The daemon launches with `batchPolicy` (SP-003 contract preserved).
- The chokidar watcher starts on `Paths.inbox()` (SP-003).
- The SP-004 post-persist hook is wired (`packages/daemon/src/index.ts` extended).
- The OllamaAdapter is constructed at daemon boot; GET `http://localhost:11434/api/version` records Ollama's version in a `classify.ollama_version` event. GET `http://localhost:11434/api/tags` verifies the configured model is loaded; absent model throws `ClassifierConfigurationError` and the daemon exits non-zero.
- Telemetry: `classify.ollama_version` event recorded; no classify-stage events yet (no transitions have happened).

### Step 3 — Drop one file of each allowed MIME type

In a separate shell:
```bash
cp ~/Documents/some-agent-paper.pdf $(corpus path inbox)/
cp ~/notes/retrieval-tutorial.md    $(corpus path inbox)/
cp ~/notes/raw.txt                  $(corpus path inbox)/
cp ~/clippings/distributed-article.html $(corpus path inbox)/
```

Expected within ~5-90 seconds per file (SP-003 ingest is < 5s; SP-004 classify wall-clock dominates the rest depending on model + body length):
- SP-003 ingest produces 4 sentinel rows (verified by SP-003's existing telemetry: `inbox.allowlist_hit`, `ingest.normalized`, `ingest.completed`).
- SP-004 post-persist hook fires for each row:
  - `classify.started` event (doc_id, model_name='qwen3.5:9b', vocabulary_snapshot_id).
  - `classify.ollama_request` event (prompt_token_estimate).
  - `classify.ollama_response` event (response_token_count, duration_ms).
  - `classify.term_proposed` event (0 or more, for novel domain / tag candidates).
  - `classify.completed` event (doc_id, facet_domain, facet_type, tag_count, confidence_summary, retry_count, duration_ms).
- For each row: SQL UPDATE transitions `facet_type` from `'unclassified'` to one of `{entity, concept, tutorial, analysis, reference, synthesis, cheat-sheet}`; `facet_domain` is one of the 3 established domains (or routes to failure lane if classifier failed to match).
- For each row: body file's YAML frontmatter is rewritten to mirror the SQL state, plus `summary` field.

### Step 4 — Verify SQL ↔ frontmatter consistency (SC-CLASSIFY-005)

```bash
# All 4 rows transitioned out of sentinel state
sqlite3 $(corpus path index-db) << 'EOF'
SELECT id, facet_domain, facet_type, tags_json
FROM documents
WHERE facet_type != 'unclassified';
EOF

# All 4 body files have classifier frontmatter
for f in $(find $(corpus path docs-store) -name "doc-*.md"); do
  echo "=== $f ==="
  head -15 "$f"
done
```

Expected:
- 4 rows printed, each with non-empty `facet_domain`, a 7-value-enum `facet_type`, a 3-10-element `tags_json`.
- Each body file's frontmatter contains: `id`, `source_path`, `ingest_timestamp`, `mime_type`, `hash`, `title` (SP-003-preserved); plus `facet_domain`, `facet_type`, `tags`, `summary` (SP-004-written). NO `confidence`, NO `provenance_*`, NO `origin`.
- For every row, the SQL `(facet_domain, facet_type, tags_json)` exactly matches the body-file frontmatter's `(facet_domain, facet_type, tags)`.

### Step 5 — Verify the SP-002 read path returns the SP-004-classified data

Use any MCP-aware client:
```bash
DOC_ID=$(sqlite3 $(corpus path index-db) "SELECT id FROM documents LIMIT 1")
corpus mcp-test-read "corpus://docs/$DOC_ID"
```

Expected:
- Response is the normalized Markdown body with the SP-004-rewritten YAML frontmatter.
- Frontmatter contains classifier output.
- A `resource.read` SP-002 telemetry event is recorded (success).

```bash
corpus mcp-test-read "corpus://taxonomy"
```

Expected:
- Response carries the 3 established domains + 5 established tags from Step 1's seed.
- ZERO proposed-state rows in the response (SC-CLASSIFY-009 — `corpus://taxonomy` filters on `state='established'`).

---

## Live verification — manual reenrich of sentinel backlog (SC-CLASSIFY-006, SC-CLASSIFY-007)

### Step 1 — Produce a sentinel backlog

Stop the daemon temporarily and ingest a few files (SP-003 produces sentinel rows; without the daemon's post-persist hook firing, the rows stay sentinel):

```bash
# (One option: edit config.toml to disable the classify-stage hook temporarily,
#  then re-enable. Another option: pre-SP-004 the backlog is natural.)
# Drop 5 documents via corpus drain (one-shot mode that processes inbox without daemon)
cp ~/papers/*.pdf $(corpus path inbox)/
corpus drain  # SP-003-only ingest mode; no SP-004 hook
```

### Step 2 — Run `corpus reenrich`

```bash
corpus reenrich
```

Expected on stderr (interactivePolicy):
```
[1/5] doc-ab12cd34 (some-paper.pdf) ... classified in 4.2s (domain=agent-systems, type=tutorial)
[2/5] doc-cd34ef56 (...) ... classified in 5.1s (domain=...)
...
```

Expected on stdout:
```
classified=5, failed=0, skipped=0
```

Expected:
- Exit code 0.
- `Paths.drainLock()` was acquired; if the SP-003 daemon was running, the daemon's lock would have caused the CLI to emit `pipeline.lock_contention` and exit 0 — confirms FR-CLASSIFY-015.
- Every row now has `facet_type != 'unclassified'`.

### Step 3 — Re-run reenrich on an already-classified corpus (SC-CLASSIFY-013)

```bash
corpus reenrich
```

Expected:
- Exit code 0.
- Summary: `classified=0, failed=0, skipped=0`.
- Wall-clock under 1 second (no Ollama HTTP calls; the sentinel-row query returned an empty set).

### Step 4 — Dry-run mode

```bash
# Seed one new sentinel row by dropping a doc while daemon is off:
cp ~/new-doc.md $(corpus path inbox)/
corpus drain

corpus reenrich --dry-run
```

Expected:
- Lists the 1 sentinel row that WOULD be classified.
- Issues ZERO Ollama HTTP calls.
- Exit code 0.

---

## Live verification — proposed-term routing (SC-CLASSIFY-008, SC-CLASSIFY-009)

### Step 1 — Drop a document outside the seeded established domain set

```bash
# Create a document whose subject is clearly outside agent-systems / distributed-systems / machine-learning
cat > /tmp/quantum-paper.md << 'EOF'
# Quantum Key Distribution Protocols: A Survey

This paper surveys quantum key distribution (QKD) protocols including BB84, E91, and continuous-variable schemes. We compare their security guarantees under different adversarial models...
EOF

cp /tmp/quantum-paper.md $(corpus path inbox)/
```

### Step 2 — Wait for classification

```bash
# If daemon is running, classification happens autonomously.
# Otherwise:
corpus reenrich
```

### Step 3 — Inspect taxonomy_terms

```bash
sqlite3 $(corpus path index-db) << 'EOF'
SELECT axis, term, state FROM taxonomy_terms ORDER BY axis, term;
EOF
```

Expected:
- The 3 original established domains + 5 established tags still present (state='established').
- One or more NEW rows with `state='proposed'` for the quantum-paper's novel domain (e.g., `quantum-cryptography` or `cryptography`) and possibly novel tags.

```bash
corpus mcp-test-read "corpus://taxonomy"
```

Expected:
- Response carries ONLY the original 3 + 5 (state='established'). The proposed terms are INVISIBLE to this resource (SC-CLASSIFY-009).

### Step 4 — Inspect the classified row

```bash
sqlite3 $(corpus path index-db) << 'EOF'
SELECT id, facet_domain, facet_type, tags_json
FROM documents
WHERE title LIKE '%quantum%';
EOF
```

Expected:
- The row's `facet_domain` is one of the 3 ORIGINAL established domains (the classifier's closest-fitting choice). NOT the proposed value (proposed value lives in taxonomy_terms only).
- `facet_type` is one of the 7-value enum.
- `tags_json` contains established tags only (or a mix of established + proposed tags, with the proposed ones also landing in taxonomy_terms).

---

## Live verification — SIGTERM atomicity (SC-CLASSIFY-004, SC-CLASSIFY-015)

```bash
# Drop a large document that takes time to classify
cp ~/big-doc.pdf $(corpus path inbox)/

# Start daemon
corpus daemon start &

# Mid-classify, send SIGTERM
sleep 5
pkill -TERM -f "corpus daemon"
```

Expected:
- Daemon exits within 2 seconds.
- The in-flight document's row stays sentinel (`facet_type='unclassified'`).
- A `<doc-id>.error.json` sidecar appears in `Paths.failed()` with `error_code='classify_aborted', retriable=true`.
- No orphan tmp file under `Paths.cache()` older than the test start time.
- Telemetry: `classify.failed` event with `error_code='classify_aborted'`.

---

## Live verification — drain-lock concurrency (SC-CLASSIFY-014)

```bash
# Daemon running (holds drain-lock during active drain)
corpus daemon start &

# Quickly invoke reenrich
sleep 1
corpus reenrich
```

Expected:
- The reenrich command emits `pipeline.lock_contention` telemetry and exits 0 within ~100ms.
- Zero Ollama HTTP calls from the reenrich invocation.

---

## Fixture-driven verification — vocabulary violation (SC-CLASSIFY-010)

Mock-Ollama responses can't be safely injected via the live setup. The fixture harness covers this:

```bash
npm run test -- tests/integration/classify-failure-lane.test.ts -t "vocabulary violation"
```

Expected:
- A mock-Ollama response with `facet_domain='hallucinated-domain'` (not in established seed) AND empty `facet_domain_proposed` produces a failure-lane sidecar with `error_code='vocabulary_violation'`.
- The SQL row stays sentinel.

---

## Fixture-driven verification — schema-invalid Ollama response (FR-CLASSIFY-005)

```bash
npm run test -- tests/integration/classify-failure-lane.test.ts -t "schema invalid"
```

Expected:
- A mock-Ollama response missing a required field (e.g., `summary`) triggers Zod parse failure.
- 1 retry happens automatically.
- If the retry also fails, the row routes to failure lane with `error_code='schema_invalid', retriable=true, retry_count=1`.

---

## Fixture-driven verification — mid-transaction failure rollback (SC-CLASSIFY-012)

```bash
npm run test -- tests/integration/classify-atomicity.test.ts -t "rollback"
```

Expected:
- A test harness that injects a SQL exception between the documents UPDATE and the COMMIT triggers rollback.
- The row stays sentinel.
- The tmp body file is cleaned up.
- A `classify.failed` event is emitted with `error_code='persist_failed'`.

---

## Fixture-driven verification — telemetry coverage (SC-CLASSIFY-011)

```bash
npm run test -- tests/integration/classify-telemetry-coverage.test.ts
```

Expected:
- A mixed-workload run (10 happy-path + 2 schema-invalid + 2 vocabulary-violation + 1 Ollama unavailable + 1 SIGTERM) produces ≥ 6 distinct classify.* event classes in `Paths.telemetry()`.
- Every emitted event validates against the Zod telemetry schema.

---

## What's NOT working yet (honest scope partition)

SP-004 is the classifier owner. Several downstream behaviors are scoped to later SPs and are NOT verifiable from SP-004 alone:

- **`corpus.find` returns an empty SearchHit list.** SP-005 (embedding + ranking) has not landed. After SP-004:
  - `corpus://taxonomy` returns the established vocabulary (real values now, not just empty arrays).
  - `corpus://docs/{id}` returns classified frontmatter.
  - `corpus.find` still returns `[]` — no ranking layer.
- **Kill-9 (SIGKILL) mid-classify cross-stage survival is NOT guaranteed.** SP-004 ships SIGTERM coordination (graceful abort within 2s, row stays sentinel). SIGKILL during the body-file rename → SQL COMMIT window MAY leave the body file at the new state with the SQL row sentinel — recoverable on next classify-stage run (idempotent overwrite). Full cross-stage SIGKILL-recovery checkpoints are SP-006 territory.
- **`corpus://failures` MCP resource does NOT exist.** SP-006 will add the resource that exposes `<doc-id>.error.json` sidecars. Until then, the user inspects `Paths.failed() + '/<doc-id>.error.json'` directly with `jq` or `cat`.
- **`corpus drain --retry-failed` does NOT exist.** SP-006 will add the replay command. Until then, the user manually triggers re-classification by:
  - Resetting the row: `UPDATE documents SET facet_type='unclassified' WHERE id='doc-XX'`
  - Removing the sidecar: `rm $(corpus path failed)/doc-XX.error.json`
  - Running `corpus reenrich` (the row will appear in the sentinel set).
- **No user-review workflow for proposed taxonomy terms.** Proposed terms accumulate in `taxonomy_terms` at `state='proposed'`. A future-horizon sprint adds the review CLI / surface that lets the user promote proposed → established. Until then, the user inspects manually:
  - `sqlite3 $(corpus path index-db) "SELECT axis, term FROM taxonomy_terms WHERE state='proposed' ORDER BY axis, term"`
  - Manually promote via SQL: `UPDATE taxonomy_terms SET state='established', established_at=datetime('now') WHERE axis='domain' AND term='quantum-cryptography'`.
- **No `corpus reclassify <doc-id>` per-doc command.** SP-004 ships only the batch `corpus reenrich` command. Per-document re-classification (e.g., after a model swap or vocabulary update) requires the manual reset-then-reenrich pattern above. FR-019 (`corpus reclassify`) is future-horizon SP-010.
- **No worker-pool parallelism.** `corpus reenrich` processes one document at a time, single-threaded. A backlog of 100 documents at 30s/doc on qwen3.5:9b takes 50 minutes. Acceptable for single-user / single-machine v1; revisit at SP-005 if benchmarks demand.

---

## Troubleshooting

- **`classify.ollama_unavailable` events firing in a loop**: Ollama isn't running. Start it: `ollama serve` (or `systemctl --user start ollama` if installed as a service). Verify: `curl http://localhost:11434/api/version`.
- **`ClassifierConfigurationError` at daemon boot**: The configured model isn't loaded. Either load it (`ollama pull qwen3.5:9b`) or switch the config to a loaded model (`config.toml [classifier].model = "gemma3:4b"`). Verify: `ollama list`.
- **`classify.schema_invalid` events firing frequently**: The Ollama version may not support the `format` parameter. Verify: `curl http://localhost:11434/api/version` returns 0.5+. Upgrade Ollama if older.
- **Per-document classify wall-clock exceeds 60s consistently**: Switch to `gemma3:4b` (`config.toml [classifier].model = "gemma3:4b"`). Or extend the per-doc budget via `[classifier].per_doc_timeout_ms = 120000` (interactive) / `[classifier].batch_per_doc_timeout_ms = 600000` (batch).
- **Proposed terms accumulating without promotion**: Expected behavior. Future sprint adds review UI; manual SQL promotion in the meantime.
- **`corpus reenrich` says `failed=N` for N rows**: Inspect the sidecars: `for f in $(corpus path failed)/doc-*.error.json; do jq -r '"\(.doc_id): \(.error_code) - \(.message)"' $f; done`. Most failures are `retriable=true`; resetting the row + re-running often succeeds (especially after vocabulary changes or Ollama restart).
- **SQL ↔ frontmatter divergence detected**: Should be impossible per ADR-CLASSIFIER-ATOMICITY. If observed, file a bug; the SP-004 classify-persister has a bug. Workaround: reset the row + delete the body file's classifier-frontmatter fields, then reenrich.

---

## Reference paths (resolved through `Paths.*`)

| Symbol | Default XDG location |
|---|---|
| `Paths.inbox()` | `~/.local/share/llm-corpus/docs/inbox/` |
| `Paths.failed()` | `~/.local/share/llm-corpus/docs/failed/` |
| `Paths.docsStore()` | `~/.local/share/llm-corpus/docs/store/` |
| `Paths.indexDb()` | `~/.local/share/llm-corpus/index.db` |
| `Paths.telemetry()` | `~/.local/state/llm-corpus/telemetry.jsonl` |
| `Paths.drainLock()` | `~/.local/state/llm-corpus/drain.lock` |
| `Paths.config()` | `~/.config/llm-corpus/` (carries `config.toml` with `[classifier]` section) |
| `Paths.cache()` | `~/.cache/llm-corpus/` (tmp writes via `withTempDir`) |

Override the data root via `CORPUS_HOME=/path/to/root` (single user-facing override per Constitution XIV).
