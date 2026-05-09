# Quickstart — Verify Feature 002 Locally

**Feature**: 002-mcp-resources
**Date**: 2026-05-05

This quickstart walks through verifying that feature 002's implementation satisfies all 10 SP-002 success criteria from `spec.md` on the developer's primary machine. It assumes the implementation is complete (post-`/speckit-implement`); for SP-002 development time, the steps below are the regression suite.

**Honest scope**: Some success criteria run against the live empty-corpus SP-001 baseline (e.g., SC-002, SC-003, SC-004). Others run against test fixtures simulating SP-003/004/005/006 output (e.g., SC-005, SC-006, SC-007). The fixture-driven SCs re-verify against real data once those features ship — `npm run test:integration:populated-real` is the post-SP-005 hook for that.

## Prerequisites

- Linux (Fedora 43+ baseline) or macOS, inherited from SP-001.
- Node.js 20 LTS or 22 LTS. Verify: `node --version`.
- npm (bundled with Node).
- Repo cloned at `~/Projects/llm-corpus/` on the feature branch (when it exists; SP-002 plan landed on `main`).
- SP-001 implementation present and passing (egress hook live, MCP server with `corpus.find` tool registered, telemetry sink at `Paths.telemetry()` working).

## Build & Test

```bash
cd ~/Projects/llm-corpus
npm install                              # picks up the new js-yaml dep; native-addon allowlist still satisfied
npm run build                            # compiles TS; runs build:verify-native-addons
npm run lint                             # NFR-001 + Const. XI/XIII/XIV; new rule no-writes-from-resource-handlers
npm run test                             # full unit + integration suite — expect all green
```

**Expected outcomes:**
- `npm install` succeeds. `js-yaml` is a pure-JS dependency; no native-addon allowlist change.
- `npm run lint` exits 0 on a clean repo. The new `no-writes-from-resource-handlers` rule fires only on intentional violations.
- `npm run test` runs every test under `tests/`. SP-002's new tests are listed below.

## SC-001 — Coverage check (every requirement has a passing scenario)

```bash
npm run test:integration -- --reporter verbose
```

Each of the spec's 17 acceptance scenarios (US1: 4, US2: 4, US3: 4, US4: 5) runs as an `it(...)` test in the SP-002 integration suite. SP-001's tests continue to pass. Verify every test passes — if any fails, SC-001 is unmet.

## SC-002 — Resource discoverability (4 canonical resources)

```bash
npm run test:integration -- --grep 'mcp-resources-list'
```

The test runs the MCP server, issues `resources/list` AND `resources/templates/list` over stdio, and asserts:

- `resources/list` returns exactly three entries with URIs `corpus://manifest`, `corpus://taxonomy`, `corpus://recent`.
- `resources/templates/list` returns exactly one template with `uriTemplate: corpus://docs/{id}`.
- No resource appears at any non-canonical URI (`corpus://manifest.json`, `/manifest`, etc.).
- The lists are stable across cold-starts (test boots the server twice, verifies the same response).

## SC-003 — Manifest auto-load annotation

```bash
npm run test:integration -- --grep 'manifest-auto-load-annotation'
```

The test issues `resources/list` and asserts the `corpus://manifest` entry carries the standard MCP `annotations` object indicating eligibility for auto-load at session start (per `contracts/resource-manifest.md`).

**Per Constitution XVI** (Validation Honesty): this test verifies the *annotation is attached* by the server. Whether any specific MCP client honors the annotation is the client's responsibility, not a v1 server guarantee.

## SC-004 — Empty-corpus shape parity

```bash
# Run against a fresh, empty CORPUS_HOME — no fixtures
CORPUS_HOME=$(mktemp -d -t sp002-empty-XXXXXX)
npm run test:integration -- --grep 'resource-empty-corpus'
```

The test boots the MCP server with `CORPUS_HOME` pointing at a fresh empty directory, runs the schema migration (creates the empty `documents` and `taxonomy_terms` tables), reads each of the four resources, and asserts the empty-state payload shape per the per-resource contracts:

- `corpus://manifest` → `{doc_count: 0, established_domains: [], established_tags: [], last_ingest_timestamp: null, schema_version: "v1.0.0", taxonomy_version: "v1.0.0"}`
- `corpus://taxonomy` → `{domains: [], tags: [], types: [], source_types: []}`
- `corpus://recent` → `{entries: []}`
- `corpus://docs/doc-anything` → MCP error code `-32010` (`document_not_found`)

Each empty payload validates against its Zod schema. This is the **canonical SP-002 verification surface** — runs LIVE against the empty SP-001 index, no fixture dependency.

## SC-005 — Promoted-only taxonomy (fixture-driven)

```bash
npm run test:integration -- --grep 'taxonomy-promoted-only'
```

The fixture loader sets up a corpus with 2 promoted domains, 3 promoted tags, AND 2 proposed-but-unpromoted tags in the `taxonomy_terms` table. The test reads `corpus://taxonomy` and asserts:

- The `domains` axis contains exactly the 2 promoted domains (with correct document_counts from the fixture documents).
- The `tags` axis contains exactly the 3 promoted tags (NOT the 2 proposed tags).
- Both proposed tags are absent from ALL four axes.

This verifies the Constitution XV exclusion contract on a representative populated state. Re-verifies against real classifier output once SP-004 ships.

**Re-verification post-SP-004**: `npm run test:integration:populated-real -- --grep 'taxonomy-promoted-only'` (no-op until SP-004).

## SC-006 — Failure-lane exclusion in recent (fixture-driven)

```bash
npm run test:integration -- --grep 'recent-failure-lane-exclusion'
```

The fixture loader sets up 5 documents with `status='success'` and 5 with `status='failed'`. The test reads `corpus://recent` and asserts:

- `entries.length === 5` (only successful documents).
- All 5 returned entries have ids matching the success-fixture documents.
- Zero failure-lane document ids appear in `entries`.
- Order is descending by `ingest_timestamp`.

**Re-verification post-SP-006**: `npm run test:integration:populated-real -- --grep 'recent-failure-lane-exclusion'` (no-op until SP-006 ships the failure lane).

## SC-007 — SearchHit URI integrity (fixture-driven)

```bash
npm run test:integration -- --grep 'searchhit-uri-dereference'
```

The fixture provides 5 known fixture documents AND 5 fixture SearchHits whose `uri` fields point at those documents (the JSON file `tests/fixtures/sp002-populated/searchhit-fixture-uris.json`). The test:

1. Validates each fixture SearchHit URI matches `^corpus://docs/doc-[0-9a-f]{8}$`.
2. Reads each URI as an MCP resource via `resources/read`.
3. Asserts each read succeeds (no `document_not_found`).
4. Parses each response payload as `DocumentPayload`.
5. Asserts each `payload.frontmatter.id === searchHit.id` (one URI ↔ one document).

Zero dereference mismatches across the 5-fixture set is the pass criterion.

**Re-verification post-SP-005**: `npm run test:integration:populated-real -- --grep 'searchhit-uri-dereference'` runs the same test against real `corpus.find` SearchHits returned from the populated index.

## SC-008 — Error contract correctness

```bash
npm run test:integration -- --grep 'resource-error-paths'
```

Three sub-tests, each verifying one error path:

1. **`document_not_found`**: read `corpus://docs/doc-missing` against an empty corpus. Assert MCP error code `-32010`, message `document_not_found`, and `data.uri == "corpus://docs/doc-missing"`.

2. **`index_locked`**: a synchronous helper opens a SECOND SQLite connection to the same fixture corpus, begins an exclusive transaction holding the WAL writer lock, then the test issues `resources/read` for `corpus://docs/{any_existing_id}`. With `busy_timeout=5000ms` and the writer holding the lock past that window, the adapter returns `IndexLockedError`. The test asserts MCP error code `-32011`, message `index_locked`, `data.retriable === true`, and a `data.retry_after_ms` advisory ≥ 0.

3. **`server_initializing`**: boot the MCP server with `ready: false` (don't call `markReady()`), issue `resources/list`. Assert MCP error code `-32002`, message `server_initializing`, `data.retry_after_ms === 1000`, and `data.phase === "bootstrapping"`. Then call `markReady()` and re-issue — assert success with the four canonical resources / templates.

## SC-009 — Telemetry coverage

```bash
npm run test:integration -- --grep 'resource-telemetry-50-read'
```

The 50-read mixed-workload test (per `contracts/telemetry-resource-events.md` §"Test coverage"):

- 10 reads of each of the four resources against fixture data (40 success reads).
- 5 reads of `corpus://docs/doc-missing-*` (5 not-found reads).
- 5 reads while a synchronous fixture holds the WAL writer lock (5 index-locked reads).

Asserts:
- Exactly 50 `resource.read` events appended to `Paths.telemetry()` during the test window.
- Every event validates against `ResourceReadEvent`.
- Per-event size ≤ 4096 bytes.
- Outcome distribution: 40 `success`, 5 `document_not_found`, 5 `index_locked`.
- Per-event `request_id` is unique.
- Per-event `duration_ms ≥ 0`.

Zero reads produce no telemetry event. This is SC-009's pass criterion.

## SC-010 — Read-only enforcement (by construction)

```bash
npm run test:integration -- --grep 'resource-read-only-lint'
```

The test runs the eslint rule `no-writes-from-resource-handlers` over the resource-handler call graph (`packages/transport/src/resource-*-handler.ts` and `packages/storage/src/{manifest,taxonomy,recent,document}-adapter.ts` and the imported helpers). Asserts zero violations.

Plus a fixture-driven smoke:
1. Open a fixture corpus, count rows in `documents` and `taxonomy_terms`.
2. Issue 50 mixed resource reads (same workload as SC-009).
3. Re-count rows in both tables.
4. Assert COUNT(*) is unchanged in both tables (read-only by construction at runtime).

The eslint pass + the runtime row-count smoke together satisfy SC-010 ("read-only-ness is enforced by construction, not by reviewer vigilance").

## Pass/Fail Summary

After running all of the above, the SP-002 verification report is:

| Success Criterion | Status |
|---|---|
| SC-001 — Coverage (every requirement has a passing scenario) | ☐ |
| SC-002 — Resource discoverability (4 canonical URIs) | ☐ |
| SC-003 — Manifest auto-load annotation attached | ☐ |
| SC-004 — Empty-corpus shape parity (canonical baseline) | ☐ |
| SC-005 — Promoted-only taxonomy (fixture; re-verify post-SP-004) | ☐ |
| SC-006 — Failure-lane exclusion in recent (fixture; re-verify post-SP-006) | ☐ |
| SC-007 — SearchHit URI integrity (fixture; re-verify post-SP-005) | ☐ |
| SC-008 — Error contract correctness (`document_not_found`, `index_locked`, `server_initializing`) | ☐ |
| SC-009 — Telemetry coverage (50-read mixed workload) | ☐ |
| SC-010 — Read-only enforcement (eslint + row-count smoke) | ☐ |

Mark each box ☑ when the corresponding test passes. All ten green ⇒ SP-002 implementation is complete on the empty-corpus surface and the fixture-driven populated surface, ready for `/speckit-tasks` retrospective and SP-003 entry.

## Honest re-verification track

The fixture-driven SCs (SC-005, SC-006, SC-007) re-verify against real data when their upstream features ship:

- **Post-SP-003 (ingest)**: Real documents flow into the corpus. Re-run SC-006 (failure-lane exclusion) and SC-007 (SearchHit URIs) against real ingested documents. The `test:integration:populated-real` script no-op'd until this point.
- **Post-SP-004 (classification)**: Real proposed/established taxonomy state. Re-run SC-005 against real classifier output.
- **Post-SP-005 (search ranking)**: Real `corpus.find` SearchHits. Re-run SC-007 against real-search SearchHit URIs (replaces fixture URIs).
- **Post-SP-006 (failure lane)**: Real failure-lane state machine. Re-run SC-006 against real failure-lane behavior.

The SP-002 test suite remains the regression baseline; populated-real is additive verification.

## Manual smoke test (optional, one-off)

For a hands-on confidence check before relying on the integration suite:

```bash
# Boot the MCP server interactively (stdio)
npm run mcp:start &
MCP_PID=$!

# Use the MCP Inspector or a one-off MCP CLI to:
# 1. Issue resources/list — see the three static resources
# 2. Issue resources/templates/list — see the corpus://docs/{id} template
# 3. Read corpus://manifest — see the empty-state payload
# 4. Read corpus://docs/doc-doesnotexist — see the document_not_found error
# 5. Tail Paths.telemetry() — see one resource.read event per read

tail -f $(node -e "import('@llm-corpus/contracts').then(c => console.log(c.Paths.telemetry()))")

kill $MCP_PID
```

This is for developer confidence; the integration suite is the authoritative gate.
