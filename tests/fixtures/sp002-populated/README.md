# SP-002 Populated-Corpus Fixtures

This directory holds source-controlled fixture *templates* used by SP-002
integration tests to simulate populated-corpus state — what SP-003 (ingest),
SP-004 (classification), and SP-005 (ranking) will eventually produce in
real form.

## Why fixtures (not real data)

SP-002 ships against the SP-001 empty-baseline index. None of SP-003/004/005
is implemented yet, but SP-002 needs to verify populated-state behavior
(SC-005, SC-006, SC-007). Fixture templates encode that future state.

Re-verification against real data runs post-SP-003/004/005/006 via:
```
npm run test:integration:populated-real
```
That script is a no-op until those upstream features ship.

## Files

| File | Purpose | SC coverage |
|---|---|---|
| `documents.sql` | 5 standard fixture documents (INSERT INTO documents) | populated baseline |
| `taxonomy-promoted.json` | 2 promoted domains + 3 promoted tags | manifest populated |
| `taxonomy-mixed.json` | 2 promoted domains + 3 promoted tags + 2 PROPOSED tags | SC-005 (Constitution XV exclusion) |
| `recent-25-success.sql` | 25 successful ingests (descending timestamps) | FR-007 N-window |
| `recent-mixed-failure.sql` | 5 success + 5 status='failed' rows | SC-006 (failure-lane exclusion) |
| `searchhit-fixture-uris.json` | 5 SearchHits whose `uri` fields point at fixture doc ids | SC-007 (URI integrity) |
| `frontmatter-minimum.yaml` | v1 minimum frontmatter template (id/source_path/ingest_timestamp/mime_type/hash) | per-doc body files |

## Column-list discipline (R6 — fixture drift mitigation)

Every fixture SQL file under this directory MUST insert columns by importing
the canonical column list from `packages/storage/src/schema-migration.ts`
(via the fixture-loader helper). Hardcoded column ordering or column names
in raw fixture SQL is forbidden — drift between SP-003's real ingest writer
and the fixtures must surface as a fixture-load failure with a clear error,
not as silent test rot.

The `fixture-loader.ts` helper validates the fixture's column set against
`DOCUMENTS_COLUMN_LIST` and `TAXONOMY_TERMS_COLUMN_LIST` exports at load
time; mismatch throws.

## Provenance

These fixtures are hand-crafted for SP-002 integration testing only.
They do NOT represent real user content. The doc IDs (`doc-ab12cd34`, etc.)
are deterministic test values, NOT collisions with any real ingest.

## Path resolution

Per Constitution XIV, runtime fixture data resolves under
`Paths.sp002FixturesRoot()` (= `Paths.cache() + '/sp002-fixtures/'`).
The templates in this directory are the source-of-truth; the fixture-loader
copies/executes them into per-test isolated subdirectories at test time
and cleans up afterward.

NEVER use `os.tmpdir()` or `/tmp/` for fixtures.
