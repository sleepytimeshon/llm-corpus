# ADR — Classifier atomicity: paired SQL UPDATE + body-file frontmatter rewrite in a single SQLite transaction

**Feature**: 004-classifier
**Date**: 2026-05-13
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none

## Context

SP-004 must mirror the classifier output to TWO durable surfaces:

1. The `documents` SQLite row's `facet_domain`, `tags_json`, `facet_type` columns.
2. The body-file YAML frontmatter at `Paths.docs() + '/' + row.body_path` (Decision I layout from SP-003: `'store/<id-prefix>/<doc-id>.md'`).

Plus, optionally:

3. Zero-or-more `taxonomy_terms` rows at `state='proposed'` (for novel domain / tag proposals).

These three surfaces MUST stay consistent. An SQL ↔ frontmatter divergence (e.g., the SQL row says `facet_domain='agent-systems'` but the frontmatter says `facet_domain: ''`) violates SC-CLASSIFY-005 and breaks the SP-002 `corpus://docs/{id}` read contract (which returns the frontmatter to the agent).

Principle VIII mandates atomic writes (`tmp + fsync + rename + dirsync` with PID-and-entropy temp suffix) AND transactional index updates (multi-row index writes commit together or not at all). Principle X mandates idempotent transitions (re-running classify on a classified row is a no-op).

A process crash (SIGTERM, SIGKILL, power loss, panic) at any moment during the classify-stage MUST leave the system in a recoverable state: either fully classified (all three surfaces durable and consistent) OR fully unclassified (row stays sentinel; body file at the SP-003-written frontmatter; no orphaned taxonomy_terms rows; no orphaned tmp files older than the janitor's 1-hour sweep window).

## Decision

The classify-persister commits the SQL UPDATE + 0..N taxonomy_terms INSERTs + the body-file rename in a single SQLite transaction, with the body-file written to a tmp path OUTSIDE the transaction and the atomic rename happening at the LAST step before `COMMIT`.

**Step-by-step**:

1. **Outside the transaction**: Generate the rewritten body-file content via `stringifyMarkdownWithFrontmatter({frontmatter: <classifier output>, body: <byte-preserved from SP-003 body file>})`. Write the content to a tmp path under `Paths.cache()` via `withTempDir` (atomic per Principle VIII; PID+entropy temp suffix `.tmp.{pid}.{rand4hex}`).

2. **`BEGIN TRANSACTION`** on the better-sqlite3 write-side connection.

3. **Execute** `UPDATE documents SET facet_domain=?, tags_json=?, facet_type=? WHERE id=? AND facet_type='unclassified'`. Assert the row count is 1; if 0, ROLLBACK + return `Result.err(ClassifyPersistError('row not in sentinel state'))` — defense-in-depth against concurrent classifies (FR-CLASSIFY-012).

4. **For each proposed term** in `facet_domain_proposed` / `facet_tags_proposed`: `INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES (?, ?, 'proposed', NULL) ON CONFLICT(axis, term) DO NOTHING`. Conflict-no-ops are not errors (per Decision I — idempotent).

5. **Atomic-rename** the tmp body file from `Paths.cache()` to the canonical path `Paths.docs() + '/' + row.body_path` via `fs.rename` (atomic on POSIX; the source and destination filesystems are guaranteed to be the same XDG subtree per Principle XIV). The rename is the LAST step before COMMIT.

6. **`COMMIT`**.

7. **On any failure between step 2 and step 6**: `ROLLBACK`, then delete the tmp body file (if not already renamed), then write the `<doc-id>.error.json` sidecar at `Paths.failed() + '/<doc-id>.error.json'` with the matching `error_code` and `retriable` flag. The sidecar write is independently atomic via `withTempDir` (a write outside the rollback scope; if it also fails, the failure surfaces to the caller as `Result.err`).

## Rationale

**Why a single SQLite transaction**:
- Multi-row SQL writes (the documents UPDATE + 0..N taxonomy_terms INSERTs) MUST commit together or not at all (Principle VIII transactional index). A partial commit (e.g., taxonomy_terms INSERT succeeds, documents UPDATE fails) leaves the system in a state where a proposed term exists for a still-sentinel document — observably inconsistent.

**Why the rename happens INSIDE the transaction (before COMMIT, after the SQL writes)**:
- If the rename succeeds AFTER COMMIT: a process crash between COMMIT and rename leaves the SQL row classified but the body file at the SP-003-sentinel frontmatter state. The agent reads `corpus://docs/{id}` and gets stale frontmatter while the SQL row claims the document is classified. SC-CLASSIFY-005 broken.
- If the rename succeeds BEFORE COMMIT and the SQL COMMIT then fails: the body file is at the new state (classifier frontmatter), but the SQL row is still sentinel. On next classify-stage run, the row is still in the `WHERE facet_type='unclassified'` set; classify re-runs; the new classifier output may differ from the previous run (if the vocabulary has evolved); the body file is overwritten with the new output. No information loss (the previous body-file frontmatter was overwritten without ever being committed to the SQL side); idempotent recovery.
- The rename-just-before-COMMIT pattern means: SQL COMMIT succeeded → body file is at the new state (the rename happened before COMMIT). The narrow window is rename-success + COMMIT-failure, which leaves the body file overwritten and the SQL row sentinel — recoverable on next run.

**Why the body-file content is written OUTSIDE the transaction**:
- SQLite transactions can hold WAL locks. Writing a body file (potentially many KB) while inside a transaction would extend the writer-lock window unnecessarily, harming SP-002 reader concurrency. The tmp-write happens outside; only the atomic rename happens inside (and that rename is a single inode-level operation).

**Why the body file is byte-preserved on the body section**:
- Principle II forbids LLM-generated body content in the canonical store. The SP-003 body file's Markdown body section is the deterministic-normalization output from the SP-003 normalizer; SP-004 mutates ONLY the YAML frontmatter section, byte-preserving the Markdown body. SC-INGEST-020 (no LLM-derived content in canonical store) generalizes to SP-004: the classifier-derived frontmatter fields are metadata, not body content.

**Why `withTempDir` for the tmp body-file write**:
- It's the canonical primitive (Principle VIII). The SP-001 / SP-002 / SP-003 codebase has it; SP-004 reuses unchanged. Guarantees cleanup on success, exception, and SIGTERM. PID+entropy temp suffix prevents concurrent-writer collisions.

**Why the sidecar write happens OUTSIDE the transaction scope**:
- On the rollback path, the SQL transaction has aborted. The sidecar is a SEPARATE on-disk record indicating "this row failed classification at attempt N." It's written atomically via its own `withTempDir` invocation. If the sidecar write also fails (e.g., disk full), the failure surfaces to the caller as `Result.err` — the caller's catch block emits `classify.failed` telemetry + the daemon's structured failure handling kicks in.

**Why the `AND facet_type='unclassified'` clause**:
- Defense-in-depth idempotency. The drain-lock is the primary serialization mechanism, but if a future bug or test-harness scenario bypasses it, the UPDATE clause prevents a second classify from overwriting a fresh classification with a stale one. If the row was concurrently classified, the UPDATE affects 0 rows → ROLLBACK → no body-file overwrite → no SQL ↔ frontmatter divergence introduced.

## Alternatives considered

**Two-phase commit (write body file separately, then update SQL)**: A process crash between the two phases leaves divergent state. The two-phase commit protocol works for distributed systems but is overkill (and not directly available in SQLite) for a local single-writer scenario. Rejected.

**Write SQL first, body file after**: Same divergence risk as two-phase commit. Rejected.

**Use SQLite STORED blob for body content (eliminate body-file rewrite)**: Would put the body in SQLite, eliminating the rewrite entirely and giving native transaction semantics for the body. Rejected for SP-004:
- SP-003 ships the on-disk body-file layout; migrating to SQLite-stored bodies is a separate ADR with significant scope.
- The on-disk layout is auditable / inspectable with conventional tools (`cat`, `grep`); the user values that.
- SQLite WAL with large blobs has different performance characteristics than the file-system-based layout.

Future ADR may revisit if SQL ↔ frontmatter divergence proves a real problem in practice; for SP-004, the rename-before-COMMIT pattern provides the constitutional guarantee.

**Eventual-consistency reconciliation**: A periodic janitor scan that detects SQL ↔ frontmatter divergence and reconciles. Rejected — masks bugs rather than preventing them. The atomic transaction pattern prevents the divergence at the source.

**No transaction; write SQL with autocommit + rely on idempotency for recovery**: Idempotency on recovery is fine, but the per-classify per-document state is briefly observable as inconsistent (SQL row classified, body file still sentinel, or vice versa). Any concurrent reader (SP-002 `corpus://docs/{id}` MCP read) during that window sees inconsistent state. Rejected for the constitutional read-consistency contract.

**Hold the SQLite WAL writer lock for the entire stage (including body-file tmp-write)**: Unnecessarily extends the writer-lock window, harming SP-002 reader latency. The body-file tmp-write doesn't need WAL writer access; only the rename + commit step does. Rejected.

## Consequences

**Positive**:
- SC-CLASSIFY-005 (SQL ↔ frontmatter consistency) enforced by construction.
- SC-CLASSIFY-012 (single-transaction atomicity) verified by injection tests.
- SC-CLASSIFY-004 (drain-after-kill atomicity) holds: the row stays sentinel + no orphan tmp file older than the janitor's 1-hour sweep window.
- SP-002 reader concurrency preserved: the SQL writer-lock window is bounded to the small SQL transaction (UPDATE + 0..N INSERTs + rename + COMMIT, ~10-50 ms typical).
- FR-CLASSIFY-008 (paired SQL UPDATE + body-file frontmatter rewrite in single SQLite transaction) literally implemented.

**Negative / Risk**:
- The rename-before-COMMIT pattern has a narrow recovery window (rename succeeds, COMMIT fails) where the body file is at the new state but the SQL row is sentinel. Mitigated by the next classify-stage run re-classifying and overwriting (idempotent recovery). Tested in `classify-atomicity.test.ts`.
- The tmp body file under `Paths.cache()` is not yet covered by a transactional cleanup primitive in SP-004; an exception path that aborts mid-stage leaves the tmp file present. Mitigated by:
  - The `withTempDir` primitive's cleanup-on-exception semantic.
  - The SP-003-era janitor sweeping `Paths.cache()` tmp files older than 1 hour (Constitution VIII).
- A future migration to SQLite-stored bodies would require a follow-up ADR; the current layout is the v1 commitment.

## References

- Constitution Principle II (User Curates, LLM Classifies Metadata)
- Constitution Principle V (Schema-Enforced Structured Output)
- Constitution Principle VIII (Atomic Writes & Transactional Index Updates)
- Constitution Principle X (Idempotent Pipeline Transitions)
- Constitution Principle XIII (Telemetry-or-Die)
- `specs/004-classifier/research.md` Decision F
- `specs/004-classifier/spec.md` FR-CLASSIFY-008, SC-CLASSIFY-004, SC-CLASSIFY-005, SC-CLASSIFY-012
- SP-003 Decision I (body file layout under `Paths.docs() + '/store/<id-prefix>/<doc-id>.md'`)
- SP-003 PREREQ-005 (`withTempDir` re-export verification)
