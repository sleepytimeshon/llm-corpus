# Phase 1 — Quickstart: SP-003 Ingest Pipeline Operator Walkthrough

**Feature**: 003-ingest-pipeline
**Date**: 2026-05-12
**Audience**: operator (Shon, single-user). Walks through the end-to-end SP-003 flow against the user's primary machine.

This quickstart is the **honest verification recipe** for the SP-003 spec. Each section is partitioned into:
- **Live verification** — runs against the user's actual `Paths.*` on the primary machine; this is the canonical SP-003 verification surface.
- **Fixture-driven verification** — runs via the SP-003 integration-test fixtures; used for adversary cases (ADR-002 F-10) and failure-injection cases (telemetry-write-failure).

Constitution XVI honesty: end-to-end SCs verify live; corner-case SCs verify via fixtures. Both partitions are listed.

---

## Prerequisites

- SP-001 merged on `main` (egress hook + MCP server foundation).
- SP-002 merged on `main` (resource layer + empty-baseline schema migration + fixture harness).
- SP-003 implementation complete (`/speckit-implement` finished + all tests green).
- Node.js 20 LTS or 22 LTS installed.
- The corpus npm package built (`npm run build` at the monorepo root).
- `Paths.*` resolves under the user's actual XDG dirs (no `CORPUS_HOME` override needed for live verification — fixtures use a per-test override).

---

## Live verification — end-to-end ingest (SC-INGEST-001, SC-INGEST-002, SC-INGEST-003)

This is the load-bearing happy-path verification. Walks the entire SP-003 surface against real files on the primary machine.

### Step 1 — Initialize the corpus

```bash
corpus init
```

Expected:
- `Paths.data()`, `Paths.state()`, `Paths.config()`, `Paths.cache()` created with correct XDG layout.
- `Paths.inbox()`, `Paths.pending()`, `Paths.processed()`, `Paths.failed()` created and empty.
- `Paths.docsStore()` (`Paths.docs()/store/`) created.
- `Paths.indexDb()` initialized with the SP-002 schema PLUS the SP-003 `documents.hash` UNIQUE constraint (PREREQ-002).
- `Paths.telemetry()` exists (empty).
- `Paths.drainLock()` does not yet exist (created on first drain).

### Step 2 — Start the SP-003 daemon

```bash
corpus daemon start
```

Expected:
- The daemon launches with `batchPolicy` (per Decision H).
- The chokidar watcher starts on `Paths.inbox()` with `awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }`, `depth: 0`, `ignoreInitial: false`.
- Initial-scan completes within 5 seconds; since the inbox is empty, no files are detected.
- The master `AbortController` is wired to SIGTERM and SIGINT.
- Telemetry: no events yet (no transitions have happened).

### Step 3 — Drop one file of each allowed MIME type

In a separate shell:
```bash
cp ~/Documents/some-paper.pdf $(corpus path inbox)/
cp ~/notes/quick.md           $(corpus path inbox)/
cp ~/notes/raw.txt            $(corpus path inbox)/
cp ~/clippings/article.html   $(corpus path inbox)/
```

(`corpus path inbox` is a CLI helper that prints `Paths.inbox()`.)

Expected within the per-doc budget (target: under 5s for each, well within NFR-014):
- chokidar emits `add` events for all four files after `awaitWriteFinish` stabilizes.
- Validation gate passes each (sanity → ext → MIME-sniff → size).
- Files atomically move to `Paths.pending()`.
- Each file gets hashed (full-file SHA-256).
- Dedup check (`SELECT id FROM documents WHERE hash = ?`) returns no row → `ingest.dedup_miss` emitted.
- Per-MIME normalizer runs:
  - PDF → `runTool` invokes `tools/pdf-extractor/extract.mjs` subprocess; `tool_invoked` telemetry emitted.
  - MD → in-process passthrough.
  - TXT → in-process minimal-Markdown wrap.
  - HTML → in-process turndown.
- Body files written to `Paths.docsStore() + '/<id-prefix>/<doc-id>.md'` atomically.
- Single SQLite transaction inserts the `documents` row + renames the source file from `pending/` to `processed/<doc-id>__<filename>`.
- Telemetry: `inbox.allowlist_hit`, `ingest.dedup_miss`, `ingest.normalized`, `ingest.completed` (per doc).

### Step 4 — Verify state

```bash
# Four rows with status='success'
sqlite3 $(corpus path index-db) "SELECT id, mime_type, hash, status FROM documents"

# Four body files in canonical store
find $(corpus path docs-store) -name "doc-*.md" | wc -l

# pending/ is empty (three-folder routing invariant)
ls $(corpus path pending)

# processed/ has 4 files with doc-id-prefixed names
ls $(corpus path processed)

# failed/ is empty
ls $(corpus path failed)

# At least 4 distinct event classes in telemetry
jq -r '.event' $(corpus path telemetry) | sort -u
```

Expected:
- 4 rows, each `status='success'`, with the four distinct MIME types and four distinct 64-hex hashes.
- 4 body files under `Paths.docsStore()` matching the `body_path` columns.
- `Paths.pending()` is empty (Constitution X invariant).
- `Paths.processed()` has 4 forensics copies.
- `Paths.failed()` is empty.
- ≥4 distinct event classes (will grow to ≥6 in Step 6's mixed workload).

### Step 5 — Verify the SP-002 read path returns the SP-003 data (SC-INGEST-003)

Use any MCP-aware client (or a test harness that issues `resources/read`):
```bash
# Get one of the doc-ids
DOC_ID=$(sqlite3 $(corpus path index-db) "SELECT id FROM documents LIMIT 1")

# Read corpus://docs/<doc-id> via the SP-002 resource
corpus mcp-test-read "corpus://docs/$DOC_ID"
```

Expected:
- Response is a normalized Markdown body with YAML frontmatter.
- Frontmatter contains: `id` (equals `$DOC_ID`), `source_path`, `ingest_timestamp` (valid ISO-8601 UTC), `mime_type` (one of the 4 allowlisted), `hash` (lowercase 64-hex).
- Body matches what SP-003 wrote.
- A `resource.read` telemetry event with `result: 'success'` appears in `Paths.telemetry()` (SP-002 telemetry, unchanged).

---

## Live verification — content-hash idempotency (SC-INGEST-005)

```bash
# Drop the same MD file under a different name
ORIG=~/notes/quick.md
cp $ORIG $(corpus path inbox)/quick-copy.md
```

Expected within the per-doc budget:
- Validation passes.
- Hash matches the existing row's hash.
- `ingest.dedup_hit` telemetry emitted with `existing_doc_id` pointing at the original.
- NO new `documents` row.
- `Paths.pending()` is empty (the duplicate was removed without becoming a Processed File).
- `sqlite3 ... 'SELECT COUNT(*) FROM documents'` is unchanged.

---

## Live verification — validation rejection paths (SC-INGEST-007, SC-INGEST-008, SC-INGEST-009)

```bash
# Disallowed MIME
cp ~/Downloads/something.docx $(corpus path inbox)/
# Disallowed MIME
cp ~/Downloads/archive.zip $(corpus path inbox)/
# Extension/content mismatch
echo "%PDF-1.0" > /tmp/fake.md
cp /tmp/fake.md $(corpus path inbox)/fake.md
# Oversize (replace 100M with whatever 1 byte over max_file_size_mb is)
fallocate -l $((100*1024*1024 + 1)) /tmp/oversize.txt
cp /tmp/oversize.txt $(corpus path inbox)/
```

Expected:
- Each file routes to `Paths.failed()` within the per-doc budget.
- Each file has a sibling `.error.json` sidecar.
- error_codes are: `mime_not_allowlisted`, `mime_not_allowlisted`, `mime_mismatch`, `size_exceeded`.
- Telemetry: `inbox.allowlist_miss` (×2), `inbox.mime_mismatch`, `inbox.size_exceeded`.
- ZERO `documents` rows for these files.

```bash
# Verify
ls $(corpus path failed)/*.error.json | xargs -I{} jq -r '.error_code' {}
```

---

## Live verification — three-folder routing invariants (SC-INGEST-002)

After all of the above:

```bash
# pending/ is empty
test "$(ls $(corpus path pending) | wc -l)" = "0" && echo "OK: pending empty"

# Every processed/ file has a documents row
for f in $(ls $(corpus path processed)); do
  doc_id="${f%%__*}"
  count=$(sqlite3 $(corpus path index-db) "SELECT COUNT(*) FROM documents WHERE id='$doc_id' AND status='success'")
  test "$count" = "1" || echo "FAIL: $f has no success row"
done

# Every failed/ file has a sidecar AND no success row matching source_path
for f in $(ls $(corpus path failed)); do
  case "$f" in *.error.json) continue ;; esac
  test -f "$(corpus path failed)/$f.error.json" || echo "FAIL: $f missing sidecar"
done
```

Expected: every assertion passes.

---

## Live verification — SIGTERM-abort within 2 seconds (SC-INGEST-016)

```bash
# Drop a large PDF
cp ~/big-papers/60mb-paper.pdf $(corpus path inbox)/

# In another shell, mid-ingest:
pkill -TERM -f "corpus daemon"

# Time the exit
```

Expected:
- The daemon exits within 2 seconds.
- The in-flight document is in `Paths.failed()` with `error_code='aborted', retriable=true`.
- Telemetry `ingest.aborted` is emitted.

---

## Live verification — drain-lock concurrency (SC-INGEST-015)

```bash
# Daemon is running (holds the lock when actively draining)
corpus drain --force-now &
PID_A=$!

# Quickly start a second drain
corpus drain --force-now &
PID_B=$!

wait $PID_A
wait $PID_B
```

Expected:
- One process acquires the lock and processes files.
- The other emits `pipeline.lock_contention` telemetry and exits 0.
- Both processes exit 0 (no double-ingest).
- The `pending/` invariant holds.

---

## Fixture-driven verification — ADR-002 F-10 adversary (SC-INGEST-006)

The 60-MB identical-prefix-different-tail adversary case is not safe to run in arbitrary user home directories (size, signal-to-noise). The SP-003 fixture harness ships pre-generated adversary inputs:

```bash
npm run test -- tests/integration/dedup-content-hash.test.ts
```

Expected:
- `tests/fixtures/sp003-ingest/adversary-60mb-identical-prefix-A.bin` and `B.bin` both ingest as separate `documents` rows.
- Distinct hashes verified.
- Neither is treated as a dedup of the other.

---

## Fixture-driven verification — telemetry-write failure honest-failure (SC-INGEST-013)

This case mounts the JSONL parent directory read-only mid-test to simulate ENOSPC. Can only be done in the test harness with controlled paths:

```bash
npm run test -- tests/integration/telemetry-coverage.test.ts -t "honest failure"
```

Expected:
- An in-flight ingest hits a telemetry-write failure.
- The document routes to `Paths.failed()` with `error_code='telemetry_write_failed', retriable=true`.
- The exception is observable to the caller.
- The system does NOT silently complete the ingest.

---

## What's NOT working yet (honest scope partition)

SP-003 is the producer side of the corpus. Several downstream behaviors are scoped to later SPs and are NOT verifiable from SP-003 alone:

- **`corpus.find` returns an empty SearchHit list.** SP-005 (embedding + ranking) has not landed. The MCP `corpus.find` tool is registered (SP-001) and `corpus://taxonomy` returns empty established lists (SP-002 + SP-003 sentinel `tags_json='[]'`). After SP-003, `corpus.find` still returns `[]` — no ranking layer.
- **Documents are not yet classifiable.** SP-004 (LLM classifier) has not landed. After SP-003:
  - `corpus://taxonomy` still returns empty `established_domains` and `established_tags` arrays.
  - `documents.facet_domain` is `''`; `tags_json` is `'[]'`; `facet_type` is `'unclassified'`.
  - These sentinel values are observably-unclassified; SP-004 will overwrite them in place.
- **Kill-9 mid-stage survival is NOT guaranteed.** SP-003 ships SIGTERM coordination (graceful abort within 2s). SIGKILL-recovery (resumable cross-stage checkpoints) is SP-006 territory. After a kill-9 mid-ingest:
  - A file may be left in `Paths.pending()` (Constitution X invariant temporarily broken until the next drain).
  - On daemon restart, the drain's initial-scan WILL pick up the orphaned file and re-process it.
  - This is the SP-003-acceptable failure mode; SP-006 strengthens it.
- **`corpus://failures` MCP resource does NOT exist.** SP-006 will add the resource that exposes `.error.json` sidecars. Until then, the user inspects `Paths.failed() + '/*.error.json'` directly with `jq` or `cat`.
- **`corpus drain --retry-failed` does NOT exist.** SP-006 will add the replay command. Until then, the user manually moves a `failed/` entry back to `Paths.inbox()` to re-attempt (drain will dedup if the hash matches an existing row).
- **The `tools/pdf-extractor/extract.mjs` shim is the only subprocess.** The MD, TXT, HTML normalizers run in-process. Future MIME additions (Word, RTF, etc.) are out of scope per ADR-007 v1.

---

## Troubleshooting

- **chokidar emits no events on file drop** — on macOS, verify the `fsevents` peer installed (`ls node_modules/fsevents`). If absent, chokidar fell back to polling at 100ms interval; detection works but with higher latency. Reinstall via `npm install --include=optional` if needed.
- **inotify ENOSPC at daemon start (Linux)** — bump the watch limit: `sudo sysctl fs.inotify.max_user_watches=524288`. Make permanent via `/etc/sysctl.d/...`.
- **PDF subprocess hangs** — the per-doc timeout (60s interactive / 300s batch) kicks in; the file routes to `failed/` with `error_code='extract_failed'`. Check the sidecar `message` field for the stderr trail.
- **`pending/` has leftover files after `corpus daemon stop`** — kill-9 happened, or SIGTERM came mid-drain past the 2-s abort window. Restart the daemon; initial-scan picks them up.
- **Telemetry JSONL is unparseable** — verify the file isn't truncated; cross-check that every line ends with `\n`. A partially-truncated last line is a known SP-003 surface for hard kills (SP-006 mitigates).

---

## Reference paths (resolved through `Paths.*`)

| Symbol | Default XDG location |
|---|---|
| `Paths.inbox()` | `~/.local/share/llm-corpus/docs/inbox/` |
| `Paths.pending()` | `~/.local/share/llm-corpus/docs/pending/` |
| `Paths.processed()` | `~/.local/share/llm-corpus/docs/processed/` |
| `Paths.failed()` | `~/.local/share/llm-corpus/docs/failed/` |
| `Paths.docsStore()` | `~/.local/share/llm-corpus/docs/store/` |
| `Paths.indexDb()` | `~/.local/share/llm-corpus/index.db` |
| `Paths.telemetry()` | `~/.local/state/llm-corpus/telemetry.jsonl` |
| `Paths.drainLock()` | `~/.local/state/llm-corpus/drain.lock` |
| `Paths.config()` | `~/.config/llm-corpus/` |
| `Paths.cache()` | `~/.cache/llm-corpus/` |

Override the data root via `CORPUS_HOME=/path/to/root` (single user-facing override per Constitution XIV).
