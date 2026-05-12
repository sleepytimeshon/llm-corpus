# Phase 1 — Data Model: Inbox Watcher + Ingest Pipeline

**Feature**: 003-ingest-pipeline
**Date**: 2026-05-12

This document formalizes the SP-003 entities, their fields, invariants, lifecycle, persistence paths, and their mapping into the existing SP-002 `documents` SQLite table. It also enumerates the 14 new telemetry event-class Zod schemas added to the existing `TelemetryEvent` discriminated union in `packages/contracts/src/telemetry.ts` (PREREQ-003).

---

## Entity 1 — Inbox File

A file dropped by the user into `Paths.inbox()` via filesystem operation (`cp`, `mv` rename, `scp`). Not yet a corpus document.

**Fields (observable, not persisted)**:
- `filename: string` — original filename as it landed in the inbox.
- `absolute_path: string` — `path.join(Paths.inbox(), filename)`.
- `size_bytes: number` — from `fs.stat`.
- `mtime_ms: number` — from `fs.stat` (observability only; NOT part of hash or dedup decision per spec Edge Case "mtime independence").
- `detected_mime: string` — from `file-type` sniff over the first ~4 KB of magic bytes (per ADR-007 / FR-INGEST-002).

**Invariants**:
- File is in `Paths.inbox()` (the watcher monitors only that path, depth=0 per Decision E).
- File is not yet in any other state directory (`pending/`, `processed/`, `failed/`).

**Lifecycle**:
- Created: by the user via filesystem operation.
- Detected: by chokidar `add` event with `awaitWriteFinish` stable.
- Transitions to: Pending File (on validation pass) OR Failed File (on validation reject).

**Persistence path**:
- `Paths.inbox() + '/<filename>'`.

---

## Entity 2 — Pending File

A validated Inbox File atomically moved to `Paths.pending()` awaiting hashing + normalization.

**Fields (transient — same content as Inbox File)**:
- `filename: string` — same as Inbox File.
- `absolute_path: string` — `path.join(Paths.pending(), filename)`.
- `size_bytes`, `mtime_ms`, `detected_mime` — carried from validation gate.

**Invariants**:
- File is in `Paths.pending()`; NOT in `Paths.inbox()`, `Paths.processed()`, or `Paths.failed()`.
- The move from `inbox/` to `pending/` is atomic (`tmp + fsync + rename + dirsync` via the existing `withTempDir`-based primitive; Constitution VIII).
- `pending/` MUST be empty at the end of any drain run (FR-INGEST-003, Constitution X).

**Lifecycle**:
- Created: by validation gate on pass.
- Transitions to: Processed File (on successful ingest) OR Failed File (on pipeline error during hash/normalize/persist).
- Removed (no transition): on dedup hit — duplicate content is deleted from `pending/` without creating a new row (FR-INGEST-005).

**Persistence path**:
- `Paths.pending() + '/<filename>'`.

---

## Entity 3 — Processed File

A successfully ingested file, atomically moved to `Paths.processed()` with a uniquified filename (forensic copy of the original drop).

**Fields**:
- `original_filename: string` — what the user dropped (preserved for forensics).
- `absolute_path: string` — `path.join(Paths.processed(), uniquified_filename)` where `uniquified_filename` is generated per Decision I's no-overwrite contract. Concrete shape: `path.join(Paths.processed(), `${doc_id}__${original_filename}`)` so two distinct drops of differently-named identical content don't collide (defense-in-depth even though dedup short-circuits before reaching here).
- `doc_id: string` — the assigned `doc-[0-9a-f]{8}` id (derivable from the corresponding `documents` row).

**Invariants**:
- File exists in `Paths.processed()`.
- Corresponds 1:1 with a `documents` row whose `status='success'`.
- The atomic rename from `pending/` to `processed/` and the `documents` INSERT happen in the same SQLite transaction (Constitution VIII transactional index).
- The rename MUST NEVER overwrite a pre-existing file (FR-INGEST-003 + spec Edge Case "Filename collision in processed/").

**Lifecycle**:
- Created: by persister, atomically with the `documents` row INSERT.
- Terminal state in SP-003 (no further transitions). SP-006 may introduce a re-ingest / trash flow later.

**Persistence path**:
- `Paths.processed() + '/<doc-id>__<original-filename>'`.

---

## Entity 4 — Failed File

A file rejected at the validation gate or by a pipeline error, atomically moved to `Paths.failed()` with a sibling `.error.json` sidecar.

**Fields**:
- `original_filename: string`.
- `absolute_path: string` — `path.join(Paths.failed(), original_filename)`. Filename uniquification optional in SP-003 (FR-INGEST-007 does not mandate; SP-006 may add); on collision, the rename appends `-<8-hex-random>` defensively.
- `sidecar_path: string` — `path.join(Paths.failed(), original_filename + '.error.json')`.

**Invariants**:
- File exists in `Paths.failed()`.
- A sibling `.error.json` sidecar exists at `sidecar_path` (FR-INGEST-007 + SC-INGEST-010).
- NO `documents` row exists with `status='success'` whose `source_path` matches the failed file's original inbox path (SC-INGEST-011). Rows with `status='failed'` MAY exist if a future SP-006 partial-state-recovery feature lands; SP-003 ships the "no success row" guarantee.

**Lifecycle**:
- Created: by validation gate (rejection) OR by pipeline error handler.
- Terminal state in SP-003. SP-006's `corpus drain --retry-failed` will replay these later.

**Persistence path**:
- `Paths.failed() + '/<original-filename>'` + sidecar.

---

## Entity 5 — `.error.json` Sidecar

A structured-data record adjacent to a Failed File capturing rejection / failure context.

**Fields (Zod-schema-validated; FR-INGEST-007 + SC-INGEST-010)**:

```typescript
const ErrorSidecarSchema = z.object({
  error_code: z.enum([
    'filename_sanity_failed',
    'mime_not_allowlisted',
    'mime_mismatch',
    'size_exceeded',
    'file_unstable',
    'extract_failed',
    'normalize_failed',
    'persist_failed',
    'telemetry_write_failed',
    'aborted',
  ]),
  message: z.string().max(1024),     // bounded for telemetry size-budget compatibility
  retriable: z.boolean(),
  source_path: z.string(),           // original inbox path
  stage: z.enum(['validate', 'normalize', 'persist']),
  timestamp: ISO8601,
});
```

**Invariants**:
- Exactly one sidecar per Failed File.
- Sidecar file is valid JSON (SC-INGEST-010).
- Sidecar write is atomic (`tmp + fsync + rename + dirsync`; Constitution VIII).
- `error_code` is a member of the closed enum.

**Lifecycle**:
- Created: atomically with the move to `failed/`.
- Read: by future `corpus drain --retry-failed` (SP-006) and by future `corpus://failures` MCP resource (SP-006). SP-003 ships the on-disk structured data only.

**Persistence path**:
- `Paths.failed() + '/<original-filename>.error.json'`.

---

## Entity 6 — Content Hash

The lowercase-hex SHA-256 of the full file bytes (ADR-002 / FR-INGEST-004). The idempotency key for the corpus.

**Field type**: `string`, regex `^[0-9a-f]{64}$`.

**Invariants**:
- Computed via `crypto.createHash('sha256').update(stream).digest('hex')` over the entire file content as it sits in `Paths.pending()` (snapshot semantics — the hash is over the bytes at that moment).
- NOT a partial-prefix hash (ADR-002 / C-020 F-10).
- NOT a non-cryptographic hash (xxHash / Murmur explicitly excluded by ADR-002).
- NOT dependent on filename or mtime.
- The hash recorded in `documents.hash` MUST equal the SHA-256 of the bytes that were normalized into `body_path` (spec Edge Case "File modified during hash").

**Lifecycle**:
- Computed once per Pending File (single read pass via `fs.createReadStream` + `crypto.createHash`).
- Persisted in `documents.hash` (UNIQUE constraint per PREREQ-002 / FR-INGEST-004).
- Used for dedup decision (FR-INGEST-005): `SELECT id FROM documents WHERE hash = ?` before INSERT.

---

## Entity 7 — Hash Stability Decision (resolved spec ambiguity)

Spec Edge Case "File modified during hash" requires the hash to be performed on a stable snapshot. SP-003 commits to:

1. **Single-stream snapshot**: The hash is computed by a single `fs.createReadStream` pass; whatever bytes the OS returns are what get hashed.
2. **Defense-in-depth: size sanity check**: After hashing, `fs.stat` re-reads the file size. If the size has changed from the pre-hash stat, the file is treated as unstable: routed to `failed/` with `error_code='file_unstable', retriable=true`, telemetry event `ingest.file_unstable` emitted. This catches the `vim` / `echo … >>` streaming-edit case.
3. **No mtime check** (per spec Edge Case "mtime independence" — mtime is recorded for observability, NOT for the unstable decision).

---

## Entity 8 — Normalized Body

The Markdown content extracted from the inbox file, written to disk at `Paths.docsStore() + '/<id-prefix>/<doc-id>.md'` (Decision I).

**Fields**:
- `body_text: string` — the normalized Markdown body (no frontmatter delimiters, no YAML — the body file stores Markdown body PLUS its frontmatter as a single conventional `---\nYAML\n---\nMarkdown body\n` file matching SP-002's `parseMarkdownWithFrontmatter` reader contract).
- `frontmatter: object` — the FR-008 minimum surface, see below.

**File format**: `---\n<yaml-frontmatter>\n---\n<markdown-body>\n` — matches what `parseMarkdownWithFrontmatter` reads. The writer uses `stringifyMarkdownWithFrontmatter({body, frontmatter})` from `packages/contracts/src/markdown-frontmatter.ts` (existing SP-002 helper — Constitution V single YAML library).

**Invariants**:
- Body file is byte-identical to the deterministic normalization of the inbox source bytes (SC-INGEST-020).
- NO LLM-generated content (Constitution II).
- Write is atomic via `withTempDir` (Constitution VIII).
- The frontmatter `id` field MUST equal the `doc_id` that becomes the `documents.id` value (SP-002 SC-INGEST-012 integrity contract preserved).

**Frontmatter shape (FR-INGEST-006 + FR-008 minimum surface)**:

```yaml
id: doc-ab12cd34                 # equals documents.id
source_path: /home/.../inbox/foo.pdf  # absolute path as dropped
ingest_timestamp: 2026-05-12T14:23:45.123Z   # ISO-8601 UTC
mime_type: application/pdf       # one of the 4 ADR-007 types
hash: a1b2c3...64hexchars        # full-file SHA-256 lowercase
```

**Lifecycle**:
- Produced by the per-MIME normalizer in `packages/extract/`.
- Written atomically by the persister.
- Read post-ingest by SP-002's `fetchDocument` (already verified by SP-002 integration tests once SP-003 fills rows).

**Persistence path**:
- `Paths.docsStore() + '/<id-prefix>/<doc-id>.md'` where `<id-prefix> = doc_id.slice(4, 6)` (Decision I).
- Recorded in `documents.body_path` as RELATIVE to `Paths.docs()`: `'store/<id-prefix>/<doc-id>.md'`.

---

## Entity 9 — `documents` Row (SQLite)

The persistent record of one successfully ingested document. Mapped onto the SP-002 schema-migration column shape — SP-003 changes ONLY the constraint set (adds UNIQUE on `hash` via PREREQ-002), NOT the column list.

**Schema (existing SP-002 + SP-003 PREREQ-002 UNIQUE constraint)**:

```sql
CREATE TABLE IF NOT EXISTS documents (
  id                TEXT PRIMARY KEY        NOT NULL,
  title             TEXT                    NOT NULL,
  body_path         TEXT                    NOT NULL,
  source_path       TEXT                    NOT NULL,
  facet_domain      TEXT                    NOT NULL,
  tags_json         TEXT                    NOT NULL,
  facet_type        TEXT                    NOT NULL,
  source_type       TEXT                    NOT NULL,
  mime_type         TEXT                    NOT NULL,
  hash              TEXT                    NOT NULL,   -- SP-003 PREREQ-002 adds UNIQUE INDEX
  ingest_timestamp  TEXT                    NOT NULL,
  status            TEXT                    NOT NULL,
  CHECK (id GLOB 'doc-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  CHECK (status IN ('success', 'failed', 'trashed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_hash_unique ON documents(hash);
```

**SP-003 field-by-field mapping (FR-INGEST-008)**:

| Column | Value source | Sentinel? | Notes |
|---|---|---|---|
| `id` | First 8 hex of full-file SHA-256, prefixed with `doc-` | No | Stable id format; matches GLOB constraint. |
| `title` | Inbox filename basename without extension (e.g., `foo` for `foo.pdf`) | No | Best-effort; SP-004 may overwrite from extracted body content. |
| `body_path` | `'store/<id-prefix>/<doc-id>.md'` (relative to `Paths.docs()`) | No | Decision I layout. |
| `source_path` | Absolute path as dropped by the user (`Paths.inbox() + '/<filename>'`) | No | Preserved for forensics. |
| `facet_domain` | `''` (empty string) | **Yes — SP-003 sentinel** | SP-004 overwrites. Satisfies NOT NULL. |
| `tags_json` | `'[]'` (literal empty JSON array string) | **Yes — SP-003 sentinel** | SP-004 overwrites with `'["tag1","tag2"]'`. Valid JSON parseable by `json_each`. |
| `facet_type` | `'unclassified'` | **Yes — SP-003 sentinel** | SP-004 overwrites with semantic classification. Observably-unclassified. |
| `source_type` | `'inbox-filesystem'` | **Yes — SP-003 sentinel** | Identifies the SP-003 producer pathway. NOT overwritten by SP-004 (sources are stable). |
| `mime_type` | Sniffed MIME from `file-type` (one of the 4 ADR-007 types) | No | `application/pdf`, `text/markdown`, `text/plain`, or `text/html`. |
| `hash` | Lowercase-hex SHA-256 over the full file | No | UNIQUE constraint per PREREQ-002. |
| `ingest_timestamp` | ISO-8601 UTC at the moment of INSERT | No | `new Date().toISOString()` at the persister's BEGIN TRANSACTION step. |
| `status` | `'success'` | No | SP-003 writes only `'success'` on the happy path. Failed entries do NOT get a row in SP-003 (SC-INGEST-011). |

**Sentinel value rationale (Constitution XV + spec FR-INGEST-008)**:
- `facet_domain=''` is observably-empty (a SELECT DISTINCT returns `''` rather than `NULL`, but `corpus://taxonomy` filters on `state='established'` in the `taxonomy_terms` table — empty-string-domain documents do not appear under any established term until SP-004 populates `taxonomy_terms`).
- `tags_json='[]'` is valid JSON parseable by `json_each` (SP-002 taxonomy adapter uses `json_each(d.tags_json)` for tag-count aggregation — empty array contributes zero counts).
- `facet_type='unclassified'` is a stable string the SP-004 prompt MUST overwrite when it lands; in the meantime, `corpus://taxonomy` axis `types` filters on `state='established'` so `'unclassified'` does not appear unless an SP-004 future ADR explicitly promotes it.
- `source_type='inbox-filesystem'` identifies the SP-003 producer pathway durably; SP-007+ may add `url`, `email`, etc. source-types — none of which SP-003 produces.

**Invariants**:
- One row per successfully ingested document (FR-INGEST-008 + dedup short-circuit FR-INGEST-005).
- Row INSERT and body-file atomic-rename commit in a single SQLite transaction (Constitution VIII).
- All NOT NULL columns populated (no nullables in the schema).
- `hash` UNIQUE enforced by the database (defense-in-depth alongside application-level dedup).

---

## Entity 10 — Telemetry Event (14 new SP-003 classes)

All SP-003 telemetry events extend the existing `TelemetryEvent` discriminated union in `packages/contracts/src/telemetry.ts` (additive — no breaking change to SP-001/SP-002 events).

**Shared envelope fields**:
- `event_class: string` (z.literal-narrowed per class).
- `timestamp: ISO8601`.
- `severity: z.enum(['info', 'warn', 'error'])`.
- `outcome: z.enum(['success', 'rejected', 'deduplicated', 'failed', 'aborted'])`.

**Class-specific fields** (one Zod object per class; size-budget verified per Constitution IX ≤ 4096 bytes):

| Event class | `severity` | `outcome` | Extra fields | Size budget |
|---|---|---|---|---|
| `inbox.allowlist_hit` | info | success | `file_path: string (max 4096)`, `mime_type: enum`, `size_bytes: int` | ~300 B |
| `inbox.allowlist_miss` | warn | rejected | `file_path`, `mime_type`, `error_code: 'mime_not_allowlisted'` | ~300 B |
| `inbox.mime_mismatch` | warn | rejected | `file_path`, `extension: string`, `detected_mime: string`, `error_code: 'mime_mismatch'` | ~400 B |
| `inbox.size_exceeded` | warn | rejected | `file_path`, `size_bytes`, `max_bytes: int`, `error_code: 'size_exceeded'` | ~300 B |
| `inbox.filename_sanity_failed` | warn | rejected | `file_path`, `error_code: 'filename_sanity_failed'`, `reason: enum` | ~300 B |
| `inbox.watcher_resource_exhausted` | error | failed | `errno: string`, `limit_kind: enum`, `message: string (max 1024)` | ~1.5 KB |
| `ingest.dedup_hit` | info | deduplicated | `file_path`, `hash`, `existing_doc_id: string` | ~300 B |
| `ingest.dedup_miss` | info | success | `file_path`, `hash` | ~250 B |
| `ingest.normalized` | info | success | `file_path`, `doc_id`, `mime_type`, `body_path: string` | ~500 B |
| `ingest.completed` | info | success | `doc_id`, `hash`, `duration_ms: int`, `mime_type` | ~300 B |
| `ingest.file_unstable` | warn | failed | `file_path`, `error_code: 'file_unstable'`, `stat_before, stat_after: int` | ~300 B |
| `ingest.aborted` | warn | aborted | `file_path`, `doc_id` (optional), `stage: enum` | ~300 B |
| `pipeline.lock_contention` | info | success | `lock_path: string`, `requesting_pid: int` | ~250 B |
| `persist.failed` | error | failed | `file_path`, `error_code: enum`, `message: string (max 1024)`, `stage: enum` | ~1.5 KB |

**Discriminator**: `event_class` (matching the pre-existing `nfr_008_pilot` PILOT event family's discriminator). The egress / resource event families use `event` as the discriminator; SP-003 introduces `event_class` to stay consistent with the pilot family's pattern. The `TelemetryEvent` union is updated to `z.discriminatedUnion`-merge two discriminator fields by wrapping in `z.union([egressFamily, pilotFamily, sp003Family])` since Zod's `discriminatedUnion` requires a single discriminator key.

Actually — to keep the union shape clean: SP-003 events use the same `event` discriminator (string-literal per class). This matches the SP-001/SP-002 existing `event` field (`egress.attempted`, `egress.blocked`, `resource.read`, etc.). The PILOT family's `event_class` is a separate concern (different envelope shape). Codified at implementation time in `packages/contracts/src/telemetry.ts`.

**Size-budget verification**: The worst plausible payload (`persist.failed` with a 1024-char message + 4096-char file path + envelope) is ~5.6 KB. Therefore the `file_path` field is bounded to `max(2048)` and `message` to `max(1024)`. Total payload stays under 4096 bytes per Constitution IX. The Zod schemas enforce these bounds; the existing `TelemetrySizeExceededError` from `packages/contracts/src/telemetry.ts` is the runtime guard.

**Invariants**:
- One event per state transition per document (FR-INGEST-009).
- Schema-validated before serialization (Constitution V).
- Append atomic to `Paths.telemetry()` (Constitution IX).
- NO body content in any payload (SC-INGEST-014).

---

## Entity 11 — Drain Lock

Advisory `flock(LOCK_EX | LOCK_NB)` file-lock held by the active drain process at `Paths.drainLock()`.

**Fields**: file descriptor + lock state.

**Invariants**:
- Single-writer: at most one drain process holds the lock at any time (FR-INGEST-011 / SC-INGEST-015).
- Concurrent invocation emits `pipeline.lock_contention` telemetry and exits 0.
- Released on: normal exit, exception, SIGTERM (Constitution VII coordination).

**Lifecycle**:
- Acquired: at drain start via `fcntl.flock(fd, LOCK_EX | LOCK_NB)` (Linux/macOS).
- Released: in `finally` block; SIGTERM handler also releases.

**Persistence path**:
- `Paths.drainLock()` (existing SP-001/SP-002 path).

---

## Entity 12 — Validation Gate Config (`config.toml`)

Configurable parameters read from `config.toml` at boot.

```toml
[ingest]
max_file_size_mb = 100         # default; user-configurable
per_doc_timeout_ms = 60000     # interactive policy default
batch_per_doc_timeout_ms = 300000  # batch policy default
```

**Invariants**:
- Loaded by `packages/storage/src/config-loader.ts` (existing SP-002 helper, extended with `[ingest]` section).
- `max_file_size_mb` ∈ [1, 1024]; out-of-range throws `ConfigurationError` at boot (Constitution XVI honest failure).
- Missing file → defaults applied (max_file_size_mb = 100).

---

## Persistent state summary

What SP-003 writes (atomically, transactionally):

| Path | What | When |
|---|---|---|
| `Paths.pending() + '/<filename>'` | Pending File | Validation pass |
| `Paths.processed() + '/<doc-id>__<filename>'` | Processed File | Persister commit |
| `Paths.failed() + '/<filename>'` | Failed File | Validation reject OR pipeline error |
| `Paths.failed() + '/<filename>.error.json'` | Error sidecar | Same atomic step as Failed File move |
| `Paths.docsStore() + '/<id-prefix>/<doc-id>.md'` | Normalized body file | Persister commit |
| `Paths.indexDb()` (table `documents`) | Documents row | Persister commit (in same SQLite transaction as body-file rename) |
| `Paths.telemetry()` (JSONL append) | Telemetry events | Every state transition |
| `Paths.drainLock()` (flock state, no content) | Drain lock | Drain start; released on exit |

What SP-003 does NOT write:
- `taxonomy_terms` table — remains empty until SP-004.
- Any `corpus://failures` resource state — SP-006 adds this.
- Any `synthesis/` namespace content — Constitution II forbids.

---

## State transitions (cross-entity)

```
   user drop
       │
       ▼
   [Inbox File]
       │
       ▼  validation gate (FR-INGEST-002)
   ┌───┴─────────────────────────────────────────┐
   │ pass                              fail      │
   ▼                                             ▼
[Pending File]                          [Failed File + sidecar]
   │
   ▼  hash + dedup check (FR-INGEST-004, FR-INGEST-005)
   ┌───┴─────────────────────────────┐
   │ dedup_miss          dedup_hit   │
   ▼                                 ▼
normalize (FR-INGEST-006)        remove from pending/
   │                             telemetry: ingest.dedup_hit
   ▼  persist transaction
[Processed File] + [documents row] + [body file in docsStore]
   │
   ▼ telemetry: ingest.normalized, ingest.completed
  end
```

The pipeline transition function shape (Constitution X): `(state, input) → next_state | error` is pure modulo IO. Each arrow above is one transition. Re-running the same transition on the same input produces the same output (verified by dedup short-circuit on hash equality).

---

## Field-level mapping into the SP-002 schema (recap, FR-INGEST-008 contract)

This recapitulates the most load-bearing piece for forward compatibility. SP-003 writes the columns; SP-004 overwrites the four sentinel columns later.

| Column | SP-003 writes | SP-004 overwrites? | Why the sentinel works |
|---|---|---|---|
| `id` | `doc-XXXXXXXX` | No | Stable identity. |
| `title` | filename basename | Maybe (heuristic title extraction) | SP-004 reads body, may improve. |
| `body_path` | `'store/XX/doc-XXXXXXXX.md'` | No | Canonical body file location. |
| `source_path` | absolute inbox path | No | Forensics. |
| `facet_domain` | `''` | **Yes** | SP-004 classifier writes. |
| `tags_json` | `'[]'` | **Yes** | SP-004 classifier writes. |
| `facet_type` | `'unclassified'` | **Yes** | SP-004 classifier writes. |
| `source_type` | `'inbox-filesystem'` | No | SP-003-produced documents always have this. |
| `mime_type` | sniffed MIME | No | Stable per-file. |
| `hash` | full-file SHA-256 | No | Idempotency key. |
| `ingest_timestamp` | ISO-8601 UTC at INSERT | No | Stable per-ingest. |
| `status` | `'success'` | No (SP-003-only writer) | SP-006 may add `'trashed'` rows. |

SP-002 verified its readers against these column shapes via fixture rows; SP-003 produces rows of the same shape, so the SP-002 integration tests re-run green against real SP-003 data per SP-002 plan's `test:integration:populated-real` script.
