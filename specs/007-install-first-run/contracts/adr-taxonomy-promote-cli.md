# ADR-014 — `corpus taxonomy promote` CLI Subcommand: Arg Shape, Drain-Lock Contract, Idempotency, Interaction with SP-004 Proposed-Term Routing

**Feature**: 007-install-first-run
**Date**: 2026-05-15
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none
**Related ADRs**: ADR-012 (install/uninstall surface); ADR-015 (curated seed); SP-004 classifier ADRs (proposed-term routing)

## Context

The SP-006 retrospective C-045 (HIGH) identified the cold-start vocabulary UX gap: even with a curated seed at first-run, real operator corpora introduce proposed terms not in the seed. The SP-006 USER-GUIDE.md documents a raw-SQL workaround (operator runs `UPDATE taxonomy_terms SET state='established' WHERE ...`). A substrate that requires raw SQL to be useful is NOT install-complete; C-045 blocks the NFR-014 90-second exit criterion.

The dispatch prompt's C-045 recommendation says: "include both (a) `corpus taxonomy promote` CLI subcommand and (b) a curated ≤ 50-term seed delivered at first-run". SP-007 includes both. ADR-015 covers (b); this ADR covers (a).

Without ADR-014:

- The argument shape (`--axis` enum, repeatable `--term`, threshold `--from-proposed-with-count-ge`) is undefined.
- Mutual-exclusivity semantics between the two modes are undefined.
- The drain-lock contract for the taxonomy_terms mutation surface is undefined.
- Interaction with the SP-004 proposed-term routing (the classifier's `insertProposedTerm()` path) is undefined.
- Idempotency on already-established terms is undefined.

This ADR codifies all of the above.

## Decision

**Subcommand**: `corpus taxonomy promote`. Registered as a verb on the existing `packages/cli/src/index.ts` dispatcher (alongside `mcp`, `daemon`, `drain`, `reenrich`, `reindex`).

**Argument shape**:

- `--axis=<v>` — closed enum `domain` | `type` | `tag` | `source_type`. Required when `--term` is provided.
- `--term <t>` — repeatable; each occurrence appends a term to a list. Required when `--axis` is provided.
- `--from-proposed-with-count-ge=<N>` — integer in `[0, ∞)`. Mutually exclusive with `--axis/--term`.

**Mutual exclusivity** (enforced at Zod parse time via `TaxonomyPromoteArgsZodSchema.refine(...)`):

- `(axis && terms.length > 0)` XOR `(from_proposed_with_count_ge !== undefined)`.
- If both are provided OR neither is provided → Zod rejection → non-zero exit with usage hint in stderr.

**Drain-lock contract** (Constitution IX):

- BEFORE any SQL mutation, acquire `Paths.drainLock()` via `flock(LOCK_EX | LOCK_NB)`.
- On contention (lock held by daemon's classify/reenrich/reindex stage), emit `taxonomy.promote_lock_contention` telemetry + exit non-zero with clear-remediation message:

  ```
  ERROR: daemon busy; stop the daemon and retry.
  Run: corpus daemon stop
  Then: corpus taxonomy promote --axis=<v> --term=<t>
  ```

- ZERO SQL writes occur on contention (defense-in-depth).

**SQL mutation flow** (under drain-lock):

1. `BEGIN IMMEDIATE` transaction.
2. **For `--axis/--term` mode**:
   - For each term, `SELECT axis, term, state FROM taxonomy_terms WHERE axis=? AND term=?`.
   - If missing → emit `taxonomy.promote_missing_term` + ROLLBACK + non-zero exit.
   - If `state='established'` → no-op for this term; stdout `"already established: <axis>/<term>"`; emit `taxonomy.promote_completed` with `was_already_established: true`; continue to next term.
   - If `state='proposed'` → mark for UPDATE.
3. **For `--from-proposed-with-count-ge` mode**:
   - `SELECT axis, term FROM taxonomy_terms WHERE state='proposed' AND proposed_count >= ?`.
   - Mark all returned rows for UPDATE.
4. `UPDATE taxonomy_terms SET state='established', established_at=datetime('now') WHERE (axis, term) IN (...marked...)`.
5. `COMMIT`.
6. Release drain-lock.
7. For each promoted term, emit `taxonomy.promote_completed` with `was_already_established: false` + stdout `"promoted: <axis>/<term>"`.
8. Exit 0.

**Idempotency** (Constitution X):

- Re-running `corpus taxonomy promote --axis=domain --term=climbing` after the first invocation promoted `climbing`: the second invocation sees `state='established'`, emits `taxonomy.promote_completed` with `was_already_established: true`, stdout `"already established: domain/climbing"`, exits 0.
- Missing term on `--axis/--term` mode: ROLLBACK with no SQL writes; non-zero exit. The operator can verify the term name and re-run.

**Interaction with SP-004 proposed-term routing** (FR-CLASSIFY-007 + Principle XV):

The SP-004 classifier emits `facet_domain_proposed` and `facet_tags_proposed` per the classifier's structured-output contract; each proposed term is INSERTed via `packages/storage/src/taxonomy-terms-adapter.ts insertProposedTerm(db, axis, term, signal)` with hardcoded `'proposed'` state. The SP-004 path is INSERT-only — proposed terms accumulate, never get auto-promoted (Constitution XV: auto-promotion FORBIDDEN).

SP-007's `corpus taxonomy promote` is the USER-REVIEWED-PROMOTION surface that Principle XV explicitly requires. It transitions rows `proposed → established`. After promotion, the next classifier invocation sees the now-established vocabulary; previously-stuck (`facet_type='unclassified'`) documents are re-classified by `corpus reenrich` (SP-004 CLI subcommand, unchanged).

No coupling between SP-004 and SP-007 beyond reading + writing the SAME `taxonomy_terms` table under the SAME drain-lock contract.

**`--from-proposed-with-count-ge` semantics** (spec.md FR-INSTALL-014 + Edge Cases):

- `N=0` promotes EVERY proposed term, including singletons. Documented as the most-permissive option; operator chooses N based on noise tolerance.
- `N=3` is the documented "typical" threshold per the SP-006 USER-GUIDE.md guidance.
- The SP-007 spec.md commits to NO DEFAULT for N (operator must specify either `--term <t>` or `--from-proposed-with-count-ge <N>`) to avoid surprising the operator with an unexpected mass-promotion.

**No MCP exposure** (Constitution III + spec.md FR-INSTALL-023):

The promote is a CLI subcommand, NOT an MCP tool. ZERO new MCP mutation surfaces. The substrate's existing SP-002 four resources + SP-006 `corpus://failures` are read-only and unchanged.

## Consequences

**Positive**:

- Closes C-045 (HIGH) — operator can elevate proposed terms via CLI without raw SQL.
- Preserves Constitution XV (user-reviewed promotion is the only path; auto-promotion forbidden).
- Drain-lock contract preserved across the new mutation surface — no race conditions between classifier reads and promote writes.
- Two modes (per-term + threshold) cover the long-tail use case + the bulk use case.
- Idempotent on already-established (Constitution X).

**Negative**:

- Operator must stop the daemon to promote (lock contention exits non-zero). This is intentional per Constitution IX; the alternative (silent serialization) would hide concurrency issues.
- No `corpus taxonomy demote/delete` for v1 (out of scope per spec.md). Operator manually `UPDATE` / `DELETE` from `taxonomy_terms` if needed.
- The `--from-proposed-with-count-ge=0` "promote everything" option is footgun-adjacent if used carelessly — documented in spec.md Edge Cases.

**Neutral**:

- The promote surface is CLI-only by Constitution III; agents querying `corpus://taxonomy` see the post-promotion state on their next read (SP-002 resource contract preserved).

## Alternatives considered

- **`corpus taxonomy promote` as an MCP tool**: REJECTED by Constitution III (substrate, not surface) + spec.md FR-INSTALL-023 + dispatch prompt verbatim.
- **Auto-promotion based on `proposed_count` threshold**: REJECTED by Constitution XV (auto-promotion is FORBIDDEN without explicit user acknowledgment).
- **Combined `corpus taxonomy <add|promote|demote|delete>` super-command**: REJECTED for v1 — only promote is in SP-007 scope. Future-horizon if demote/delete demand surfaces.
- **`corpus taxonomy promote --interactive`** (TUI wizard listing proposed terms with [y/n] prompts): REJECTED by AG-001 (no UI / TUI / interactive install wizard).
- **No drain-lock acquisition (just `UPDATE` and rely on SQLite WAL)**: REJECTED. The classifier reads `taxonomy_terms` on every classify call; a race between classifier-read and promote-write could produce inconsistent results. The drain-lock is the SP-003/004/005/006 contract; SP-007 honors it.
- **`--from-proposed-with-count-ge` defaults to N=3**: REJECTED — defaulting silently mass-promotes; the spec.md commits to no default (operator must specify).

## Compliance / verification

- **Tests**: `tests/unit/taxonomy-promote-args.test.ts` (Zod parsing + mutual exclusivity); `tests/unit/taxonomy-promote-sql.test.ts` (UPDATE transitions + idempotent on already-established + missing-term rollback); `tests/unit/taxonomy-promote-lock-contention.test.ts` (drain-lock held → contention event + non-zero exit + ZERO SQL writes); `tests/integration/taxonomy-promote-end-to-end.test.ts` (install + seed proposed terms + run promote + run reenrich + assert re-classified).
- **Telemetry**: 3 event classes (`taxonomy.promote_completed`, `taxonomy.promote_lock_contention`, `taxonomy.promote_missing_term`).
- **Lint**: `no-process-exit-in-libs` (Constitution XI) over `packages/cli/src/install-helpers/taxonomy-promote-helpers.ts`; `process.exit` only in `packages/cli/src/taxonomy-promote-command.ts`.
- **Trigger to revisit**: operator demand for `corpus taxonomy demote/delete`, or for `--interactive`, or for auto-promotion threshold, would open an ADR-014 superseder.
