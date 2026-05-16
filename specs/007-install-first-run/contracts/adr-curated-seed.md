# ADR-015 — Curated Taxonomy Seed at First-Run: Sourcing, Storage Format, Versioning, Override

**Feature**: 007-install-first-run
**Date**: 2026-05-15
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none
**Related ADRs**: ADR-012 (install/uninstall surface); ADR-014 (taxonomy promote CLI); SP-004 classifier ADRs (taxonomy_terms schema)

## Context

The SP-006 retrospective C-045 (HIGH) identified the cold-start vocabulary UX gap. The dispatch prompt's C-045 recommendation says: "include both (a) `corpus taxonomy promote` CLI subcommand and (b) **a curated ≤ 50-term seed delivered at first-run**". SP-007 includes both. ADR-014 covers (a); this ADR covers (b).

Without a curated seed, a fresh operator on a clean install cannot classify ANY document until the operator manually populates `taxonomy_terms` (via raw SQL per the SP-006 USER-GUIDE.md workaround). That blocks the NFR-014 90-second first-run UX exit criterion — the install completes in 90 s but the corpus is functionally empty.

A curated seed solves the cold-start problem for the common case (80%-coverage of typical operator corpora). The promote CLI (ADR-014) handles the long-tail case.

Without ADR-015:

- The seed source (where the term list comes from) is undocumented.
- The seed storage format (JSON in package? code constant? config-driven?) is undocumented.
- The seed versioning (how does it evolve across CLI releases?) is undocumented.
- The override mechanism (can the operator supply their own seed?) is undocumented.
- The Zod validation contract is undocumented.

This ADR codifies all of the above.

## Decision

**Seed source** (the canonical 25-term floor):

The SP-006 USER-GUIDE.md workaround list is the v1 source-of-truth. It enumerates 5 domains + 6 types + 9 tags + 5 source_types = 25 entries, covering the documented operator workaround for cold-start classification. The SP-007 plan-stage may expand the seed up to 50 entries via Shon's curation against the pai-node01 corpus content, but the final list never exceeds 50 (per dispatch prompt C-045 cap).

The final term list is committed during the SP-007 build (in `packages/cli/src/install-resources/taxonomy-seed.json`); it is reviewed at PM-Review before merge.

**Seed storage format** (JSON in package):

```json
[
  {"axis": "domain", "term": "engineering"},
  {"axis": "domain", "term": "personal-finance"},
  {"axis": "domain", "term": "health"},
  {"axis": "domain", "term": "writing"},
  {"axis": "domain", "term": "reference"},
  {"axis": "type", "term": "article"},
  {"axis": "type", "term": "notes"},
  ...
  {"axis": "tag", "term": "..."},
  ...
  {"axis": "source_type", "term": "..."}
  ...
]
```

Location: `packages/cli/src/install-resources/taxonomy-seed.json` (bundled into the published `@llm-corpus/cli` package via the `files` field in `packages/cli/package.json`).

**Zod validation contract** (`TaxonomySeedZodSchema` in `packages/contracts/src/install-schemas.ts`):

```typescript
const TaxonomySeedEntryZodSchema = z.object({
  axis: z.enum(['domain', 'type', 'tag', 'source_type']),
  term: z.string().min(1).trim(),
}).strict();

const TaxonomySeedZodSchema = z.array(TaxonomySeedEntryZodSchema)
  .min(25)
  .max(50)
  .refine(
    (entries) => {
      const seen = new Set<string>();
      for (const e of entries) {
        const key = `${e.axis}::${e.term}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    { message: 'duplicate (axis, term) entries forbidden' }
  );
```

The Zod schema enforces: closed `axis` enum; non-empty trimmed `term`; minimum 25 entries; maximum 50 entries; no duplicate `(axis, term)` pairs. Validation happens at install-step-6 BEFORE any SQL writes — a bad seed file fails the install at parse time.

**Insertion semantics** (Constitution X idempotency + Constitution VIII atomicity + Constitution IX drain-lock):

- Install-step-6 acquires `Paths.drainLock()` via `flock(LOCK_EX | LOCK_NB)`.
- Opens a `BEGIN IMMEDIATE` transaction on the SQLite index.
- Executes `INSERT OR IGNORE INTO taxonomy_terms (axis, term, state, established_at) VALUES (?, ?, 'established', datetime('now'))` per entry.
- `INSERT OR IGNORE` is idempotent: existing rows with the same `(axis, term)` are preserved (their `state` is NOT overwritten — operator's proposed-then-promoted state survives re-install).
- `COMMIT`.
- Releases the drain-lock.

**Versioning**:

- The seed is versioned with the CLI package. Each SP-007+ release ships the current `taxonomy-seed.json`.
- The seed file does NOT carry an internal `schema_version` field — Zod parses the array directly. If a future SP-007+ adds optional fields (e.g., `proposed_count_threshold`), the schema is evolved additively + the CLI handles old + new formats.
- Operator's existing `taxonomy_terms` entries are NEVER touched by re-install (`INSERT OR IGNORE` semantics). New seed terms are additive.

**Override mechanism** (v1 vs future-horizon):

- v1: NO operator-side override flag. The bundled seed is what the install uses. The operator can elevate additional terms post-install via `corpus taxonomy promote` (ADR-014).
- Future-horizon (v1.5+): a `--seed-file <path>` flag on `corpus init` would allow the operator to supply their own seed JSON. OUT OF SCOPE for SP-007 per spec.md Out of Scope.

**Conflict handling on re-install**:

- If the operator-authored `taxonomy_terms` table contains an entry that conflicts with the seed (same `(axis, term)` but different `state`), the seed's `INSERT OR IGNORE` preserves the operator's entry. Documented in spec.md Edge Cases ("The curated taxonomy seed conflicts with an operator's prior `taxonomy_terms` entries").

**Recording in install-receipt**:

The InstallReceipt's `seeded_taxonomy_terms[]` field captures every (axis, term) pair the install attempted to insert + the wall-clock `established_at` at insert time. This is for audit; `corpus uninstall` does NOT delete seeded terms (because they may have become operationally important — operators may have indexed thousands of documents against them). Only `corpus uninstall --purge` removes the index (and with it the taxonomy_terms table).

## Consequences

**Positive**:

- Closes C-045 (HIGH) by ensuring 80%-coverage of typical operator corpora out of the box.
- The seed list is human-curated by Shon, not LLM-generated (Constitution II + Constitution XV).
- Idempotent on re-install (`INSERT OR IGNORE`) — operator's existing state is preserved.
- Zod-validated at install time — a malformed seed file fails the install at parse time, not silently.
- Versioned with the CLI package — future seed expansions ship in new releases; operator gets updates by running `npx @llm-corpus/cli@<new-version> init`.

**Negative**:

- The seed cap at 50 terms is a deliberately conservative floor; operators with niche corpora (e.g., climbing, mountaineering, AVF history) will still need the long-tail promote CLI. Documented in ADR-014.
- No operator override in v1 — operators with strong opinions about taxonomy must use `corpus taxonomy promote` post-install rather than supplying their own seed. Future-horizon.
- The seed is hard-coded by Shon at SP-007 plan-stage; if Shon's taxonomy preferences shift, the seed needs a new CLI release.

**Neutral**:

- The seed travels with the CLI binary (bundled JSON file). No remote fetch (Constitution I no egress).
- The seed's `state='established'` insertion is the ONE place where the install creates established-state taxonomy rows; the SP-004 classifier path ONLY creates proposed-state rows (structurally guaranteed by `insertProposedTerm`).

## Alternatives considered

- **No seed (operator populates `taxonomy_terms` manually post-install)**: REJECTED by C-045 dispatch prompt recommendation + spec.md FR-INSTALL-008. Without a seed, the operator hits the cold-start wall on first document drop.
- **Code constant in TypeScript (`SEED: TaxonomySeedEntry[] = [...]`)**: REJECTED for operator-inspectability — operators can't easily inspect a TS constant; a JSON file is `cat`-able pre + post install.
- **Seed loaded from a remote URL at install time**: REJECTED by Constitution I (no egress) + Constitution IV (local-first).
- **Seed embedded in `config.toml` as TOML arrays**: REJECTED — bulk data (≤ 50 entries) doesn't belong in config; the config is for tunable values, the seed is for taxonomy bootstrap.
- **Larger seed (200+ terms across all conceivable operator domains)**: REJECTED by dispatch prompt "≤ 50-term cap" + operator-hostile pre-population concern.
- **Smaller seed (only 5 domains)**: REJECTED — partial coverage of the 4-axis taxonomy still hits the C-045 wall on whichever axis is missing.
- **Auto-promotion of high-count proposed terms after first-run (e.g., `--from-proposed-with-count-ge=3` auto-runs at the end of `corpus init --smoke`)**: REJECTED by Constitution XV (auto-promotion FORBIDDEN). The promote CLI is operator-driven.
- **Per-platform seed (different terms for macOS vs Linux)**: REJECTED — single-user single-machine per Constitution IV; the seed is platform-agnostic.
- **Seed loaded from the operator's prior corpus via `--import-from <path>`**: REJECTED for v1 — adds complexity + presumes prior corpus exists. Future-horizon.

## Compliance / verification

- **Tests**: `tests/unit/install-taxonomy-seed.test.ts` (load + Zod-validate + bulk-insert + idempotent re-run + INSERT OR IGNORE preserves operator entries); `tests/integration/install-end-to-end.test.ts` (asserts ≥ 25 ≤ 50 established terms in `taxonomy_terms` post-install per SC-007-009).
- **Lint**: the seed JSON is committed in repo + Zod-validated at install time; no special lint.
- **Telemetry**: `install.step_failed` with `step: 'taxonomy_seed'` captures seed-related errors.
- **Trigger to revisit**: operator demand for `--seed-file <path>` override, or for a seed > 50 terms (would require dispatch-prompt C-045 cap revisit), or for an auto-update path that ships seed updates outside the CLI release cycle, would open an ADR-015 superseder.
