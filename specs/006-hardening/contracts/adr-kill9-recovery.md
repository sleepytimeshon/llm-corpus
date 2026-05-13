# ADR — Kill-9 Cross-Stage Recovery Algorithm + Resumability Matrix

**Feature**: 006-hardening
**Date**: 2026-05-13
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none

## Context

The post-SP-005 substrate has a fully-functional pipeline (SP-003 ingest → SP-004 classify → SP-005 embed/index/edges-build), but a `kill -9` of the daemon mid-stage produces orphaned state. The Constitution VII AbortSignal contract handles SOFT termination (SIGTERM → 2-second budget → graceful cleanup); it does NOT handle HARD termination (SIGKILL, OOM-killer, power-loss, kernel panic, machine crash). After a hard kill, the corpus has rows in inconsistent in-flight states:

- Rows with `ingest.started` in telemetry but no `ingest.completed` (validation or hash or normalize or persist sub-stage in flight)
- Rows in `facet_type='unclassified'` with `classify.started` events but no `classify.completed` (mid-LLM call)
- Rows classified but with `embed.started` events without matching `embed.completed` (mid-Ollama-embedding call)
- Rows embedded but with `index.started` events without matching `index.completed` (mid-SQL-transaction; Constitution VIII rolls back, but the row's classified state stays in place)
- Rows indexed but with `edges-build.started` events without matching `edges-build.completed` (mid-edges-insertion)

Without an automated recovery path, the operator must manually identify which docs are mid-pipeline (by inspecting `Paths.telemetry()` JSONL by hand) and either re-ingest them OR run `corpus reindex` — neither is substrate-grade ergonomics.

ARCHITECTURE-FINAL §6 + Constitution X + Constitution XIII establish the foundations for an automated recovery:

- **Telemetry is the canonical state source** (Constitution XIII): every `*.started` / `*.completed` / `*.failed` event lifecycle is durable in `Paths.telemetry()` JSONL.
- **Every pipeline transition is idempotent** (Constitution X): re-running classify on an unclassified row produces the same output; re-running embed on the same body + same model produces the same vector; re-running index on an already-indexed row is a no-op via SQL `WHERE NOT EXISTS` / `INSERT OR IGNORE`.
- **Drain-lock is the single serialization point** (Constitution IX): recovery acquires `Paths.drainLock()` and runs serially with concurrent CLI invocations.

The combination of these three foundations means a recovery scanner CAN be deterministic: read the telemetry log backwards, find orphans, route them through a resumability matrix, re-queue the resumable ones into the existing idempotent transitions, fail-clean the non-resumable ones. This ADR codifies the algorithm + matrix.

## Decision

**Algorithm**: On daemon startup, BEFORE accepting new ingest work, the recovery scanner:

1. **Acquires `Paths.drainLock()` via `flock(LOCK_EX | LOCK_NB)`**. On contention (an old daemon's recovery still running, or a CLI lock-holder), emits `recovery.scan_skipped` with `reason='lock_contention'` and exits cleanly.
2. **Emits `recovery.scan_started` event** with the current timestamp.
3. **Reads `Paths.telemetry()` JSONL backwards from end-of-file**, parsing each line as JSON. Continues until the most-recent `daemon.started` event is encountered (this is the previous daemon-session boundary). If no `daemon.started` is found (clean install or truncated log), emits `recovery.scan_skipped` with `reason='no_prior_session'` and exits cleanly.
4. **Builds a map `(doc_id, stage) → {started_ts, last_seen_ts, inbox_file?}`** for every `*.started` event in the scan window. For each map entry, checks the same window for a corresponding `*.completed` or `*.failed` event with the same `(doc_id, stage)` pair.
5. **Entries without a matching closer are emitted as RecoveryOrphan records**. A `recovery.orphan_found` event fires per orphan.
6. **Each RecoveryOrphan is routed through the resumability matrix** (see below). Resumable orphans are re-queued via the existing SP-003 → SP-005 stage surfaces (NOT a separate recovery write path); a `recovery.resumed` event fires. Non-resumable orphans get a `<doc-id>.recovery.error.json` sidecar at `Paths.failed()` with `error_code='unrecoverable_orphan'`; a `recovery.aborted` event fires.
7. **Emits `recovery.scan_completed` event** with `resumed_count`, `aborted_count`, `duration_ms`, `daemon_session_start_ts`.
8. **Releases `Paths.drainLock()`** and returns to the daemon's startup flow. The daemon then activates its watcher / classify-hook / embed-hook chains.

**Resumability Matrix**:

| Stage | Resumable Conditions | Re-queue Path | Telemetry |
|---|---|---|---|
| `ingest` | Inbox file present at `Paths.inbox() + '/' + inbox_file` | Re-run SP-003 validation + hash + normalize + persist (idempotent via hash dedup) | `recovery.resumed` |
| `ingest` | Inbox file absent | NON-resumable; write `.recovery.error.json` sidecar | `recovery.aborted` |
| `classify` | Always | Re-run SP-004 `classifyStage` (idempotent via `AND facet_type='unclassified'` defense-in-depth) | `recovery.resumed` |
| `embed` | Always | Re-run SP-005 embed-stage (idempotent via `WHERE NOT EXISTS` on `documents_vec`) | `recovery.resumed` |
| `index` | Always | Re-run SP-005 index-stage (idempotent via `INSERT OR IGNORE`) | `recovery.resumed` |
| `edges-build` | Always | Re-run SP-005 edges-builder (idempotent via `INSERT OR IGNORE`) | `recovery.resumed` |

**Recovery-during-recovery (Scenario 5 of US1)**: A `recovery.scan_started` without a matching `recovery.scan_completed` indicates the prior scan was itself killed. The new scanner emits `recovery.scan_reentry` and proceeds with the current-session scan against the current-end-of-log boundary.

**Cancellable**: `runRecoveryScan(deps, signal)` takes AbortSignal end-to-end; `signal.throwIfAborted()` between orphan resolutions and between telemetry-log read chunks. SIGTERM during recovery aborts the scan within Constitution VII 2-second budget; the partially-recovered state is consistent (idempotent transitions); a `recovery.aborted_scan` event fires.

## Consequences

**Positive**:

- Kill-9 of the daemon is now a recoverable event. The operator never has to manually identify mid-pipeline docs.
- The recovery is fully autonomous (deterministic resumability matrix; no human-in-the-loop).
- The recovery preserves Constitution VIII / IX / X / XIII invariants — it reads telemetry, re-queues through existing idempotent transitions, serializes via the drain-lock.
- The recovery is itself recoverable (Scenario 5 — recovery-during-recovery).

**Negative**:

- Adds a daemon-startup cost (typically < 1 s; 30 s timeout cap). Cold-start is slightly slower.
- Operator must know to check `Paths.failed()/*.recovery.error.json` for non-resumable orphans (the `corpus://failures` resource surfaces these alongside the SP-003 `.error.json` sidecars).
- Pathological telemetry-log size (millions of events from a very-long-running daemon) could exceed the 30 s scan timeout; in that case `recovery.aborted_scan` fires and any unrecovered orphans persist until next boot. Acceptable for v1; future-horizon if needed.

**Risk mitigations**:

- **R1 (medium) — Recovery scan race with daemon-startup**: Mitigation: `startDaemon()` AWAITS `runRecoveryScan()` before activating watchers / hooks. No concurrent classify-stage hook can fire while recovery holds the lock.
- **R2 (low) — Telemetry log corruption**: Mitigation: malformed lines are skipped with `recovery.telemetry_parse_failed` events; the scan still completes.
- **R3 (medium) — Recovery for a stage whose adapter has been removed (e.g., classify disabled in config)**: Mitigation: SP-006 ships defensive check — if the daemon's classify-hook is disabled, recovery for `classify.*` orphans is recorded as `recovery.orphan_found` but not actually re-queued (would have no effect anyway).

## Implementation Notes

- `packages/pipeline/src/recovery-scanner.ts` (NEW) — `runRecoveryScan(deps, signal): Promise<RecoveryScanResult>`.
- `packages/pipeline/src/recovery-resumability.ts` (NEW) — `classifyOrphan(orphan, deps): RecoveryResolution` returning either `{resumable: true, requeue: () => Promise<void>}` or `{resumable: false, sidecarReason: string}`.
- `packages/daemon/src/index.ts` (EXTENDED) — `startDaemon()` invokes `await runRecoveryScan(deps, signal)` after Ollama-availability check and BEFORE watcher / classify-hook / embed-hook activation.

## Status

Accepted. Implementation in `tasks.md` Phase 3 (US1 P1).
