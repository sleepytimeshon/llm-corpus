# Feature Specification: MCP Resources — Manifest, Taxonomy, Recent Ingests, Per-Document

**Feature Branch**: `002-mcp-resources`
**Created**: 2026-05-05
**Status**: Draft
**Input**: SP-002 from `.product/SPRINT-PLAN.yaml` and the SP-001 spec's "Out of Scope" line ("Other MCP resources (manifest, taxonomy, recent, per-doc) — FR-005..FR-008 in feature SP-002"). Source FR text: `.product/REQUIREMENTS.yaml` FR-005, FR-006, FR-007, FR-008. Source acceptance scenarios: `.product/ACCEPTANCE-CRITERIA.feature` (`MCP corpus resources` feature block, lines 219–312). Architecture context: `ARCHITECTURE-FINAL.md` §6 (resource catalog, lines 283–291). Constitutional context: Principles III (Substrate, Not Surface), IV (Single-User), V (Schema-Enforced Output), XIII (Telemetry-or-Die), XIV (XDG Paths), XV (Dynamic Taxonomy with User-Reviewed Promotion), XVI (Validation Honesty).

This is feature 002: the **agent's structural awareness layer**. SP-001 made the corpus *reachable* (`corpus.find` tool registered, egress sealed). SP-002 makes the corpus *legible* — agents can read what the corpus contains in structural terms (size, vocabulary, recency, document-by-id) without issuing search queries. None of these resources rank or compare documents; they expose state. SP-002 ships against the empty index that SP-001 produced; SP-003 (ingest) populates the data the resources surface. SP-002's verification therefore proves the *resource plumbing* is correct on an empty corpus, with non-empty behavior re-verified once SP-003 lands real documents.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Agent reads corpus state at session start to bias toward the corpus (Priority: P1)

An MCP-aware agent connects to the corpus over stdio at session start. The agent's MCP client auto-loads the manifest resource per the resource's `auto-load at session start` annotation. The agent now knows — without issuing any search — how many documents the corpus holds, what domains and tags are established, and when the corpus was last updated. This structural awareness lets the agent decide *whether to consult the corpus at all* before formulating a `corpus.find` query, reducing hallucinated answers on topics the corpus already covers.

**Why this priority**: This is SP-002's load-bearing user story. The whole point of SP-002 is closing the discoverability gap that pure tool-only MCP leaves: an agent can call `corpus.find` but has no cheap way to know whether the corpus is even worth consulting. The auto-load annotation on `corpus://manifest` (FR-005) is the project's lever for making "consult the corpus" the default agent behavior on knowledge-grounded questions. Without this, FR-009 (retrieval prompt templates, separate feature) is fighting an uphill battle. P1 alongside US2 because the manifest is the agent's first signal that the corpus exists.

**Independent Test**: Start the corpus MCP server. Connect an MCP-spec-compliant client over stdio. Issue a `resources/list` request. Verify the response includes a resource at `corpus://manifest` annotated for auto-load at session start. Then read the resource and verify the response payload validates against the manifest schema (doc_count integer, established_domains list, established_tags list, last_ingest_timestamp ISO-8601 or null, schema_version string). On the SP-001 empty corpus, doc_count is 0; on a populated corpus, doc_count is positive — the schema is identical.

**Acceptance Scenarios**:

1. **Given** the corpus MCP server is running over stdio, **When** an MCP client issues `resources/list`, **Then** a resource at uri `corpus://manifest` appears in the response AND the resource carries the auto-load-at-session-start annotation.
2. **Given** the corpus MCP server is running, **When** an MCP client issues `resources/list`, **Then** no resource at `corpus://manifest.json`, `/manifest`, or any other non-canonical URI appears — `corpus://manifest` is the sole canonical URI for manifest content.
3. **Given** a freshly initialized empty corpus (SP-001 baseline, zero ingested documents), **When** the client reads `corpus://manifest`, **Then** the response is schema-valid AND `doc_count` is 0 AND `established_domains` is an empty list AND `established_tags` is an empty list AND `last_ingest_timestamp` is null.
4. **Given** the manifest resource is read, **When** the read completes, **Then** a structured telemetry event is appended to `Paths.telemetry()` recording the read with severity `info`, fields including resource uri, request id, duration, and outcome (per Constitution Principle XIII).

---

### User Story 2 — Agent reads the active taxonomy to formulate filter-aware queries (Priority: P1)

An MCP-aware agent has decided (per US1) that the corpus is worth consulting. Before issuing a `corpus.find` call with a `filter.domain` parameter, the agent reads `corpus://taxonomy` to discover which domains the corpus actually has documents in. It receives the canonical list of established (user-promoted) domains and tags with per-term document counts. The agent now formulates a search with valid filter values rather than guessing, eliminating empty-result rounds.

**Why this priority**: The taxonomy resource is the *vocabulary contract* between the agent and the corpus. Without it, agents either guess filter values (low retrieval quality) or skip filters entirely (broad noisy results). FR-006 makes the filter axis discoverable. Constitutionally, this is the surface where Principle XV (Dynamic Taxonomy with User-Reviewed Promotion) becomes agent-visible: only *promoted* terms appear; proposed-but-unreviewed terms are deliberately hidden so the agent does not pollute its query against domains the user has not ratified. P1 alongside US1 because filter-aware search is the practical outcome of "the corpus is worth consulting."

**Independent Test**: With a corpus containing at least 3 established domains and 5 established tags (and at least one proposed-but-unpromoted term to validate exclusion), connect an MCP client over stdio. Issue `resources/list` and verify `corpus://taxonomy` appears. Read the resource. Verify the response lists every established term with an integer `document_count` ≥ 0 and excludes every proposed-only term. On the SP-001 empty corpus, both lists are empty; verification then runs only the schema and exclusion-on-empty paths — the proposed-vs-established distinction re-verifies once SP-004 ships classification.

**Acceptance Scenarios**:

1. **Given** the corpus has at least 3 established domains and 5 established tags, **When** the client reads `corpus://taxonomy`, **Then** each established domain appears with an integer `document_count` AND each established tag appears with an integer `document_count` AND no proposed (unpromoted) term appears.
2. **Given** the corpus has 2 proposed but unpromoted tags from prior classifications, **When** the client reads `corpus://taxonomy`, **Then** neither proposed tag appears in the response AND only established (promoted) terms are listed.
3. **Given** a corpus with zero ingested documents (SP-001 baseline), **When** the client reads `corpus://taxonomy`, **Then** the `domains` field is an empty list AND the `tags` field is an empty list AND the response is still schema-valid (empty-state response is well-formed).
4. **Given** the taxonomy resource is read, **When** the read completes, **Then** a structured telemetry event records the read per Constitution Principle XIII (fields: resource uri, request id, duration, outcome).

---

### User Story 3 — Agent surfaces recent ingests for "what's new" workflows (Priority: P2)

An MCP-aware agent answering a "what have I added recently?" or "summarize this week's research" question reads `corpus://recent` to retrieve the most recent N successfully ingested documents in descending ingest-timestamp order. Each entry carries title, domain, tags, and ingest timestamp — enough for the agent to compose a recap without dereferencing every document.

**Why this priority**: P2 because US1 and US2 are session-start prerequisites; recent-ingests is a query-time convenience that solves a narrower workflow. Important enough to ship in v1 (per FR-007 priority `must`), but not on the agent's critical path. Failure-lane documents (per Constitution Principle X, three-folder routing) are deliberately excluded — the user has not endorsed those documents, so they MUST NOT surface as "recent" content.

**Independent Test**: With 25 documents successfully ingested in the last 24 hours, the recent-window N configured to 10, and 5 documents in the failure lane, connect an MCP client. Read `corpus://recent`. Verify the response contains exactly 10 entries ordered by ingest_timestamp descending, with no failure-lane document appearing. On the SP-001 empty corpus, the response is an empty list; failure-lane exclusion re-verifies once SP-006 ships the failure lane.

**Acceptance Scenarios**:

1. **Given** at least 25 documents have been ingested in the last 24 hours and the configured recent window is N, **When** the client reads `corpus://recent`, **Then** the response contains exactly N entries AND entries are ordered by `ingest_timestamp` descending AND each entry contains title, domain, tags, and `ingest_timestamp`.
2. **Given** 5 documents are in the failure lane and 5 documents have been successfully ingested, **When** the client reads `corpus://recent`, **Then** only the 5 successfully ingested documents appear AND no failure-lane document is listed.
3. **Given** a corpus with zero successful ingests (SP-001 baseline), **When** the client reads `corpus://recent`, **Then** the response is an empty list AND the response is schema-valid.
4. **Given** the recent resource is read, **When** the read completes, **Then** a structured telemetry event records the read per Constitution Principle XIII.

---

### User Story 4 — Agent dereferences a SearchHit URI to read full document content (Priority: P1)

An agent has issued `corpus.find` and received a list of SearchHits, each carrying a URI of the form `corpus://docs/{id}`. The agent reads each URI as an MCP resource to retrieve the full document body (normalized Markdown) and structured frontmatter. The dereference is unambiguous: the URI returned by `corpus.find` resolves to exactly one document, and the document's id matches the URI's path component.

**Why this priority**: Without per-document dereferencing, `corpus.find` SearchHits are unusable beyond their summaries. The agent can read titles and snippets but cannot quote, cite, or analyze full content. FR-008's stable-URI contract is the integrity guarantee that ties the *retrieval surface* (`corpus.find`, FR-001) to the *content surface* (per-document resource): a SearchHit URI is a first-class MCP resource address. P1 because this is the load-bearing dereference path for every knowledge-grounded answer the agent ever produces; without it, retrieval results are decorative.

**Independent Test**: With a document of known id `doc-abc123` ingested, connect an MCP client. Read `corpus://docs/doc-abc123`. Verify the response body is normalized Markdown and the frontmatter contains the contracted fields (id, source_path, ingest_timestamp, mime_type, hash). Then issue `corpus.find` against a populated corpus, take each SearchHit's URI field, read it as a resource, and verify each read succeeds with the document id matching the SearchHit's URI path component. On the SP-001 empty corpus, only the not-found and index-locked error paths are exercised; the populated paths re-verify once SP-003 lands ingest and SP-005 lands real SearchHits.

**Acceptance Scenarios**:

1. **Given** a document with id `doc-abc123` exists in the corpus, **When** the client reads `corpus://docs/doc-abc123`, **Then** the response body is normalized Markdown AND the response includes structured YAML frontmatter AND the frontmatter contains `id`, `source_path`, `ingest_timestamp`, `mime_type`, and `hash`.
2. **Given** no document with id `doc-missing` exists in the corpus, **When** the client reads `corpus://docs/doc-missing`, **Then** the response is a structured MCP error AND the error code is `document_not_found`.
3. **Given** a `corpus.find` call returns 5 SearchHits (re-verified at SP-005 once ranking lands; for SP-002, exercised against fixture SearchHits whose URIs point at known doc ids), **When** each SearchHit's `uri` field is read as an MCP resource, **Then** each read succeeds AND each returned document id matches the SearchHit's URI path component.
4. **Given** the SQLite index is locked by an in-progress writer, **When** the client reads `corpus://docs/{any_existing_id}`, **Then** the response is a structured MCP error with code `index_locked` AND the error envelope marks the failure as retriable.
5. **Given** the per-document resource is read, **When** the read completes, **Then** a structured telemetry event records the read with the document id (where applicable) per Constitution Principle XIII.

---

### Edge Cases

- **Empty-corpus shape parity**: All four resources MUST return well-formed, schema-valid responses on a freshly initialized corpus with zero ingested documents. The empty case is the SP-002 verification baseline; non-empty is re-verified post-SP-003.
- **Auto-load annotation semantics**: The MCP client (not the server) decides what "auto-load at session start" means in practice — the server's responsibility is exclusively to attach the standard MCP `auto-load` annotation per the protocol. SP-002 verifies the annotation is *attached*, not that any specific client respects it. This is a Principle XVI (Validation Honesty) boundary: cross-client behavior is a property of the MCP protocol, not a v1 user-validated guarantee.
- **Proposed-vs-established taxonomy gap**: Per Constitution Principle XV, taxonomy promotion is user-acknowledged, not auto-promoted. `corpus://taxonomy` MUST surface only promoted terms. Proposed-but-unreviewed terms exist in the corpus's classifier output but MUST NOT appear here. SP-004 (classification) ships the proposed-vs-established distinction; SP-002 ships the *exclusion contract*.
- **Recent-window boundary**: When fewer than N documents exist, the response MUST contain all available documents (not pad to N). When zero documents exist, the response MUST be an empty list (not omit the field, not error).
- **Document-id determinism**: SearchHit URIs and per-document URIs MUST agree on id format (`doc-[0-9a-f]{8}` per the SP-001 corpus.find SearchHit schema). A SearchHit URI that does not dereference is an integrity-loss bug, not a "missing document" — the search index and the document store are the same SQLite file (Constitution Principle VIII, transactional index).
- **Index lock contention**: A read against `corpus://docs/{id}` while a writer holds the SQLite lock MUST return a retriable error (`index_locked`) within the cancellation window (Constitution Principle VII), not block the agent's request indefinitely.
- **Resource read while server is initializing**: Mirrors the SP-001 cold-start contract for `tools/list` (US1.4 of SP-001). A `resources/list` or `resources/read` call before index initialization completes MUST return a retriable error (`server_initializing`), not a partial or empty resource list.
- **Mutation surface check**: All four resources are read-only. None of them MAY accept arguments that mutate corpus state, register new taxonomy terms, or alter document metadata (Constitution Principle III: read-only by design).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-005 — `corpus://manifest` resource (auto-loaded).** The system MUST register a manifest resource at the canonical URI `corpus://manifest` discoverable via the standard MCP `resources/list` handshake. The resource MUST carry the standard MCP annotation indicating it is auto-loaded at session start. The resource MUST NOT be exposed at any non-canonical URI (no `corpus://manifest.json`, no `/manifest`, no aliases). On a freshly initialized empty corpus, the resource MUST return a schema-valid payload with `doc_count: 0`, an empty `established_domains` list, an empty `established_tags` list, `last_ingest_timestamp: null`, and the active `schema_version` and `taxonomy_version` strings. The manifest payload's v1 field set is: `doc_count`, `established_domains`, `established_tags`, `last_ingest_timestamp`, `schema_version`, `taxonomy_version` (per ARCHITECTURE-FINAL §6 lines 283–289). Resolution: CLAR-1 resolved 2026-05-05 — Option B (architecture-aligned set including version fields) selected to make schema/taxonomy migration debugging tractable from SP-005 onward without retrofitting the manifest contract.
- **FR-006 — `corpus://taxonomy` resource.** The system MUST register a taxonomy resource at the canonical URI `corpus://taxonomy` enumerating *established (user-promoted)* domains and tags with per-term `document_count`. Proposed-but-unpromoted terms MUST NOT appear (Constitution Principle XV: auto-promotion is forbidden). On an empty corpus, all four axis fields MUST be empty lists in a schema-valid envelope. The taxonomy response shape is a flat per-axis envelope covering all four SP-001 `SearchFilter` axes: `domains`, `tags`, `types`, and `source_types` — each a list of `{term, document_count}` records. Resolution: CLAR-2 resolved 2026-05-05 — Option B (filter-axis-complete) selected because `corpus://taxonomy` is the vocabulary contract for `corpus.find` filter values; surfacing only 2 of 4 filter axes would force agents to guess the other two, defeating the resource's purpose. Constitution Principle V (schema-enforced output) prefers completeness over surprise.
- **FR-007 — `corpus://recent` resource.** The system MUST register a recent-ingests resource at the canonical URI `corpus://recent` listing the most recently *successfully* ingested documents in descending `ingest_timestamp` order. Each entry MUST carry `title`, `domain`, `tags`, and `ingest_timestamp`. Failure-lane documents MUST be excluded (per Constitution Principle X: three-folder routing semantics). On an empty corpus, the response MUST be an empty list in a schema-valid envelope. The window semantics are count-based: the resource MUST return at most the last N successful ingests, where N is the default window size. The default N value is deferred to `/speckit-plan` per the FR-007 description ("Default window N (negotiable at Plan)"). Time-based and hybrid windowing are explicitly out of scope for v1. Resolution: CLAR-3 resolved 2026-05-05 — Option A (count-only) selected because count-based is deterministic (no clock-drift dependency on caller wall-clock), matches how agents naturally reason about recency ("show me 10 most recent"), and halves the test surface vs. hybrid for equivalent v1 product value. A future SP can add time-based or hybrid windowing if a real use case emerges.
- **FR-008 — `corpus://docs/{id}` resource.** The system MUST register a per-document resource template at `corpus://docs/{id}` such that every ingested document is addressable by its stable id. The response body MUST be normalized Markdown. The response MUST include structured YAML frontmatter containing at minimum `id`, `source_path`, `ingest_timestamp`, `mime_type`, and `hash`. URIs returned by `corpus.find` SearchHits MUST dereference here — the URI path component MUST be parseable as the document id, and reading the URI MUST return exactly that document (one URI ↔ one document). A read for an unknown id MUST return a structured MCP error with code `document_not_found`. A read while the index is locked MUST return a structured MCP error with code `index_locked` marked retriable.
- **FR-005..FR-008 / cross-cutting — Read-only by design.** All four resources MUST be read-only per Constitution Principle III. None MAY accept any input that mutates corpus state, alters taxonomy, modifies documents, or triggers ingest. Resource read MUST be observably side-effect-free except for telemetry emission.
- **FR-005..FR-008 / cross-cutting — Telemetry for every resource read.** Every resource read MUST emit a structured telemetry event to `Paths.telemetry()` per Constitution Principle XIII. Event MUST include: resource uri, request id, duration, outcome (`success` / `not_found` / `index_locked` / `server_initializing` / `error`), and document id when applicable. Telemetry MUST be emitted on success and failure paths uniformly.
- **FR-005..FR-008 / cross-cutting — Cold-start error contract.** A `resources/list` or `resources/read` call before the corpus index has finished initializing MUST return a retriable error with code `server_initializing` (not a partial resource list, not an empty payload, not a hang). This mirrors the SP-001 `tools/list` cold-start contract.

### Key Entities *(include if feature involves data)*

- **MCP resource**: a JSON-RPC-addressable corpus state surface served over stdio. The four resources (manifest, taxonomy, recent, per-document) all conform to the MCP `resources/*` method family and use the `corpus://` URI scheme.
- **Manifest payload**: a structural snapshot of corpus state. Fields: `doc_count` (integer), `established_domains` (list), `established_tags` (list), `last_ingest_timestamp` (ISO-8601 or null). Additional fields TBD pending FR-005 clarification.
- **Taxonomy payload**: the user-promoted vocabulary of the corpus. Fields: `domains` (list of `{term, document_count}`), `tags` (list of `{term, document_count}`). Schema-shape TBD pending FR-006 clarification.
- **Recent-ingest entry**: one row in the `corpus://recent` list. Fields: `title`, `domain`, `tags`, `ingest_timestamp` (ISO-8601). Excludes failure-lane documents.
- **Document resource payload**: full content of one ingested document. Body: normalized Markdown. Frontmatter (YAML): `id`, `source_path`, `ingest_timestamp`, `mime_type`, `hash` at minimum.
- **MCP error envelope**: the structured-error response shape used for `document_not_found`, `index_locked`, and `server_initializing` failure modes. Carries a `code` field, a human-readable `message`, and a `retriable` boolean.
- **Resource auto-load annotation**: the standard MCP server-emitted annotation declaring a resource as eligible for client-side auto-loading at session start. Applied to `corpus://manifest` per FR-005.
- **Established (promoted) taxonomy term**: a domain or tag that the user has explicitly ratified per Constitution Principle XV. Distinct from a *proposed* term, which is recorded by the classifier but excluded from `corpus://taxonomy` until promotion.

## Success Criteria *(mandatory)*

### Verification Strategy

For SP-002 verification, several success criteria depend on data that future features deliver. To prevent circular dependencies that would block SP-002 from ever passing:

- **Empty-corpus baseline (US1.3, US2.3, US3.3, FR-005..FR-008 empty-state requirements)**: Verified directly against the SP-001 empty index. This is the canonical SP-002 verification surface.
- **Populated-corpus paths (US1 manifest with non-zero doc_count, US2 taxonomy with non-empty terms, US3 recent with non-empty list, US4 per-doc reads on real documents)**: For SP-002, exercised against *test fixtures* — synthetic SQLite rows inserted by the test harness representing what SP-003 will produce. The fixture-driven tests demonstrate the resource handlers produce correct shapes against representative data, without requiring SP-003 to ship first.
- **Failure-lane exclusion (US3.2, FR-007 failure-lane exclusion)**: Exercised against fixture rows simulating failure-lane state. Re-verifies against the real failure lane once SP-006 (failure-lane feature) ships.
- **Proposed-vs-established taxonomy (US2.2, FR-006 promoted-only contract)**: Exercised against fixture taxonomy state with both promoted and proposed entries. Re-verifies against real classifier output once SP-004 (classification) ships.
- **SearchHit URI dereferencing (US4.3, FR-008 dereference contract)**: For SP-002, exercised against fixture SearchHits whose URIs point at known fixture document ids. Re-verifies against real `corpus.find` output once SP-005 (search ranking) ships.
- **Index-locked error path (US4.4, FR-008 index_locked contract)**: Exercised by the test harness explicitly acquiring the SQLite writer lock during a resource read. No future-feature dependency.
- **Cold-start error path (Edge case "Resource read while server is initializing")**: Exercised by issuing `resources/list` before the index initialization promise resolves. No future-feature dependency.

### Measurable Outcomes

- **SC-001 — Coverage**: For every requirement in scope (FR-005, FR-006, FR-007, FR-008, plus cross-cutting Read-only / Telemetry / Cold-start contracts), at least one Acceptance Scenario in this spec's User Stories passes when executed against the implementation.
- **SC-002 — Resource discoverability**: An MCP-spec-compliant client connected over stdio receives a `resources/list` response that includes exactly four canonical resources / resource templates: `corpus://manifest`, `corpus://taxonomy`, `corpus://recent`, and the `corpus://docs/{id}` template. No resource appears at any non-canonical URI. Verified on every cold-start of the server, on the user's primary machine.
- **SC-003 — Manifest auto-load annotation**: The `corpus://manifest` entry in the `resources/list` response carries the standard MCP annotation indicating eligibility for auto-load at session start, on every cold-start of the server.
- **SC-004 — Empty-corpus shape parity**: On a freshly initialized corpus with zero ingested documents (SP-001 baseline), reading each of the four resources returns a schema-valid payload with the empty-state field values defined in FR-005..FR-008. Verified on the user's primary machine.
- **SC-005 — Promoted-only taxonomy**: With fixture taxonomy state containing 2 promoted domains, 3 promoted tags, and 2 proposed-but-unpromoted tags, a read of `corpus://taxonomy` returns exactly the promoted entries with correct document counts and excludes both proposed entries.
- **SC-006 — Failure-lane exclusion in recent**: With fixture rows representing 5 successfully ingested documents and 5 failure-lane documents, a read of `corpus://recent` returns exactly the 5 successful entries in descending ingest_timestamp order.
- **SC-007 — SearchHit URI integrity**: For every SearchHit returned by a fixture-driven `corpus.find` call (5 hits against fixture documents), reading the SearchHit's `uri` field as a `corpus://docs/{id}` resource returns the exact document whose id matches the URI path component. Zero dereference mismatches across the fixture set.
- **SC-008 — Error contract correctness**: Reading `corpus://docs/doc-missing` (unknown id) returns a structured MCP error with code `document_not_found`. Reading `corpus://docs/{any_existing_id}` while the test harness holds the SQLite writer lock returns a structured MCP error with code `index_locked` marked retriable. Issuing `resources/list` before index initialization completes returns a structured MCP error with code `server_initializing` marked retriable.
- **SC-009 — Telemetry coverage**: For every resource read in a 50-read mixed-workload run (read of each of the four resources, mixed with success / not-found / index-locked outcomes), a structured telemetry event is appended to `Paths.telemetry()` with all contracted fields populated. Zero reads produce no telemetry event.
- **SC-010 — Read-only enforcement**: A code-search lint over the SP-002 resource-handler source files (covering the manifest, taxonomy, recent, and per-document handlers) detects zero writes to the SQLite index, zero writes to `taxonomy.yml`, and zero writes to the inbox folders. Read-only-ness is enforced by construction, not by reviewer vigilance.

## Assumptions

- **Primary user**: shonrs on Fedora workstation (pai-node01) with Claude Code as the primary MCP-aware client. Cross-agent compatibility is a portability property of MCP, not a v1 user-validated guarantee (Constitution Principle XVI).
- **Supported platforms for v1**: Linux (Fedora baseline) and macOS. Windows is out of scope for v1.
- **Prerequisite — SP-001 merged**: SP-001 (Local-Only Enforcement and MCP Server Foundation) is merged on `main`. SP-002 builds on the SP-001 MCP server registration, the egress hook, the read-only stdio transport, and the empty `corpus.find` handler. SP-002 does NOT re-implement any SP-001 surface.
- **Auto-load annotation per MCP protocol**: The MCP protocol's resource-annotation mechanism for auto-load-at-session-start is the standard one supported by `@modelcontextprotocol/sdk`. SP-002 attaches the standard annotation; client-side honoring is a property of the client, not a v1 server guarantee (Principle XVI).
- **Frontmatter schema**: The frontmatter fields exposed by `corpus://docs/{id}` (id, source_path, ingest_timestamp, mime_type, hash) are a v1 minimum surface. The full frontmatter schema is finalized in SP-004 (classification metadata schema). SP-002 commits to the minimum; SP-004 may add fields but MUST NOT remove any.
- **Fixture-driven non-empty verification**: SP-002 verifies non-empty resource shapes against test fixtures (synthetic SQLite rows representing what SP-003 / SP-004 / SP-005 will produce). Real-data verification re-runs once those features ship.
- **`corpus.find` SearchHit URI shape**: The `uri` field returned by `corpus.find` SearchHits has the form `corpus://docs/{id}` per the SP-001 contract. SP-002 dereferences this URI; if SP-005 alters the URI shape, SP-002's SC-007 must be re-verified.

## Out of Scope (deferred to other features or explicitly excluded)

- **Search ranking and SearchHit construction** (SP-005). `corpus.find` continues to return an empty SearchHit list throughout SP-002; populated SearchHits arrive with SP-005.
- **Document ingest and inbox watcher** (SP-003). SP-002 operates against the empty SP-001 index (and against test fixtures); real ingested documents arrive with SP-003.
- **Classification and frontmatter schema** (SP-004). SP-002 commits to a minimum frontmatter surface (id, source_path, ingest_timestamp, mime_type, hash) for `corpus://docs/{id}`; the full schema and the proposed-vs-established taxonomy state machine arrive with SP-004.
- **Embedding and indexing** (SP-005). The SQLite + sqlite-vec index lifecycle is shared infrastructure; SP-002 reads from it but the population path lands with SP-005.
- **Failure lane and idempotency** (SP-006). SP-002 honors the failure-lane exclusion *contract* in `corpus://recent` against fixtures; real failure-lane behavior arrives with SP-006.
- **Install / uninstall scripts** (SP-007). SP-002 does not change install behavior.
- **End-user acceptance flows** (SP-008). SP-002 verifies the resource plumbing; user-acceptance flows arrive with SP-008.
- **Other resources beyond FR-005..FR-008** (`corpus://docs/{id}/images/{n}`, `corpus://list?…`, `corpus://trash`, `corpus://failures`, `corpus://health`). ARCHITECTURE-FINAL §6 lists these additional resources; they are NOT in FR-005..FR-008 and NOT in SP-002 scope. They are deferred to later features per the SPRINT-PLAN; until those features land, those URIs MUST NOT appear in `resources/list`.
- **`notifications/resources/updated` change-notification stream**. ARCHITECTURE-FINAL §6 mentions servers may emit `notifications/resources/updated` when the corpus changes. SP-002 ships the resources themselves; change-notification semantics are deferred and tracked in the architecture archive but not committed in any SP-NNN as of this spec.
- **Taxonomy promotion workflow** (SP-004). SP-002 surfaces *promoted* terms only; it does not implement the promotion review queue or the user-acknowledgment UX.
- **Mutation surfaces of any kind**. Per Constitution Principle III, the MCP server is read-only by design. SP-002 adds zero mutation surfaces.

This feature delivers the agent's structural-awareness layer over an SP-001 foundation: the corpus becomes legible to MCP-aware agents as a structured object with size, vocabulary, recency, and dereferenceable documents. SP-002's verification is honest about what runs against the empty SP-001 index (the resource plumbing) and what re-verifies once downstream features land real data (the populated-state behaviors).
