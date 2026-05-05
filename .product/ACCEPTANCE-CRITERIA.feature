# ─────────────────────────────────────────────────────────────────────────────
# Comment-prefixed frontmatter manifest. Gherkin .feature files do not natively
# support YAML frontmatter delimiters, so this `# ---` block at file head is
# parsed by ProductBuild the same way it parses YAML frontmatter elsewhere.
# Do not remove the `# ---` markers; they are the parse anchors.
# ---
# artifact: ACCEPTANCE-CRITERIA
# project_slug: llm-corpus
# stage: 2-spec
# tier: deep
# template_version: 3.0.0
# generated: 2026-04-27T00:00:00Z
# generated_by: ProductDevelopment Skill v1.0
# product_type: developer-tool-mcp-server
# format: gherkin
# parser: cucumber-compatible
# counts:
#   features_total: 25
#   scenarios_total: 131
#   covers_must_have_requirements: 32
#   manifest_last_synced: 2026-04-26T01:05:00Z (Stage 4 PM-Review pre-handoff cleanup; full feature_manifest enumeration deferred to Stage 5 TEST-PLAN authoring)
# links:
#   requirements_canonical: ./REQUIREMENTS.yaml
#   prd: ./PRD.md
# feature_manifest:
#   - feature_name: corpus.find tool surface
#     covers_requirements: [FR-001, FR-002, FR-003, FR-004]
#     scenario_count: 14
#   - feature_name: MCP resources for corpus state
#     covers_requirements: [FR-005, FR-006, FR-007, FR-008]
#     scenario_count: 13
#   - feature_name: MCP prompt templates
#     covers_requirements: [FR-009]
#     scenario_count: 3
#   - feature_name: Inbox watcher and ingest pipeline
#     covers_requirements: [FR-010, FR-011, FR-017]
#     scenario_count: 11
#   - feature_name: Local LLM classification
#     covers_requirements: [FR-012, FR-013, FR-014]
#     scenario_count: 11
#   - feature_name: Embedding and indexing
#     covers_requirements: [FR-015]
#     scenario_count: 3
#   - feature_name: Pipeline idempotency and resumability
#     covers_requirements: [FR-016a, FR-016b]
#     scenario_count: 7
#   - feature_name: Failure lane
#     covers_requirements: [FR-018]
#     scenario_count: 4
#   - feature_name: User workflows
#     covers_requirements: [UR-001, UR-002, UR-003]
#     scenario_count: 9
#   - feature_name: Install and uninstall
#     covers_requirements: [TR-001, TR-002]
#     scenario_count: 7
#   - feature_name: Local-only enforcement
#     covers_requirements: [NFR-001, NFR-002]
#     scenario_count: 8
#   - feature_name: Performance baselines
#     covers_requirements: [NFR-003, NFR-014, NFR-015]
#     scenario_count: 9
#   - feature_name: Pipeline reliability
#     covers_requirements: [NFR-004, NFR-005]
#     scenario_count: 6
#   - feature_name: Failure lane usability
#     covers_requirements: [NFR-006]
#     scenario_count: 3
#   - feature_name: Cross-agent parity (CF carry-forwards)
#     covers_requirements: [NFR-007, NFR-008]
#     scenario_count: 2
# ---
#
# This file is in Gherkin format (Cucumber-compatible). Each Feature corresponds
# to one or more requirements in REQUIREMENTS.yaml; the back-reference is in
# the requirement's `acceptance_criteria.feature` field.
#
# Deep tier: each must-have requirement gets >=2 scenarios (typically
# happy + negative + boundary + error). Carry-forward scenarios CF-1, CF-2,
# CF-3 from Stage 1 handoff are tagged @cf-N @refines-a-NNN for traceability.
# ─────────────────────────────────────────────────────────────────────────────


# ═══════════════════════════════════════════════════════════════════════════════
# FEATURE BLOCKS BEGIN
# ═══════════════════════════════════════════════════════════════════════════════


Feature: corpus.find tool surface
  # Covers requirements: FR-001, FR-002, FR-003, FR-004
  # Source opportunity:   OPP-001

  As an MCP-aware agent
  I want to discover and invoke a corpus.find tool over stdio
  So that I can ground answers in the user's local corpus

  Background:
    Given the corpus MCP server is running over stdio transport
    And the corpus index contains at least one ingested document

  @must @smoke
  Scenario: corpus.find tool is discoverable via MCP tool-listing handshake
    Given an MCP client connected to the server over stdio
    When the client issues the standard tools/list MCP request
    Then the response includes a tool named "corpus.find"
    And the tool advertises an input schema with a query field
    And the tool advertises an output schema describing a SearchHit list

  @must @negative
  Scenario: stdio transport is the only registered transport
    Given the corpus MCP server is running
    When an MCP client attempts to connect over HTTP or SSE transport
    Then the connection is refused
    And the server logs no inbound connection event for non-stdio transports

  @must @boundary
  Scenario: server registers exactly one corpus.find tool with no aliases
    Given an MCP client connected over stdio
    When the client issues tools/list
    Then exactly one tool named "corpus.find" appears in the response
    And no aliases or duplicate registrations of corpus.find are present

  @must @error
  Scenario: tools/list during server cold-start returns retriable error
    Given the corpus MCP server is mid-initialization (index file still opening)
    When an MCP client issues tools/list
    Then the server returns a structured MCP error with code "server_initializing"
    And the error envelope marks the failure as retriable

  @must @smoke
  Scenario: corpus.find returns a ranked SearchHit list for a structured query
    Given the index contains 100 documents with known relevance for the query "chunked retrieval"
    When the client invokes corpus.find with query "chunked retrieval"
    Then the response is a list of SearchHit objects
    And each SearchHit has a stable URI, integer rank, numeric score, and excerpt
    And the SearchHits are ordered by rank ascending

  @must @negative
  Scenario: corpus.find with empty query returns structured error envelope
    Given the index contains documents
    When the client invokes corpus.find with query ""
    Then the response is a structured error envelope
    And the error code is "query_required"
    And no SearchHits are returned

  @must @boundary
  Scenario: corpus.find on an empty corpus returns an empty SearchHit list
    Given the index contains zero documents
    When the client invokes corpus.find with query "anything"
    Then the response is a SearchHit list of length zero
    And no error envelope is returned

  @must @error
  Scenario: corpus.find with malformed filter facet returns structured error
    Given the index contains documents
    When the client invokes corpus.find with a filter facet of unsupported type
    Then the response is a structured error envelope with code "invalid_filter"
    And the message field names the offending facet
    And the hint field suggests the supported facet schema

  @must @smoke
  Scenario: corpus.find ranking fuses BM25, dense, graph, and confidence signals
    Given an index with documents tagged for known BM25 hits, dense-vector hits, graph-adjacent hits, and high-confidence-classification hits
    When the client invokes corpus.find with a query that exercises all four signal sources
    Then the top SearchHits include at least one document attributable to each signal source
    And the server's ranking trace records all four input signals per ranked document

  @must @negative
  Scenario: dense-vector signal failure does not silently disable ranking
    Given the sqlite-vec extension fails to load on server start
    When the client invokes corpus.find with any query
    Then the response is a structured error envelope with code "ranking_signal_unavailable"
    And the error message names the missing signal "dense_vector"

  @must @boundary
  Scenario: ranking handles a query matching only one of the four signals
    Given the index contains a document that matches only via knowledge-graph edge (no BM25 or dense match)
    When the client invokes corpus.find with a query relevant only via graph proximity
    Then the document appears in the SearchHit list
    And the score reflects graph-only attribution

  @must @smoke
  Scenario: corpus.find non-success returns structured error envelope as MCP tool response
    Given the SQLite index file is locked by another process
    When the client invokes corpus.find with any query
    Then the response is a normal MCP tool response (not a transport exception)
    And the response body contains a structured error envelope
    And the envelope has fields error_code, message, and hint

  @must @negative
  Scenario: error envelope error_code values come from a stable enumerated set
    Given the server returns an error envelope for any failure
    When a client parses the error_code field
    Then the value is one of a documented stable enumeration
    And no free-form or stack-trace strings appear in the error_code field

  @must @error
  Scenario: transport-level disconnect during corpus.find produces no orphaned state
    Given a corpus.find call is in flight
    When the MCP client disconnects mid-response
    Then the server cleans up in-flight query state within 1 second
    And subsequent corpus.find calls succeed without index lock contention


# ═══════════════════════════════════════════════════════════════════════════════

Feature: MCP resources for corpus state
  # Covers requirements: FR-005, FR-006, FR-007, FR-008
  # Source opportunity:   OPP-002, OPP-004

  As an MCP-aware agent
  I want auto-loaded resources describing corpus state
  So that I bias toward the corpus without per-prompt nudging

  Background:
    Given the corpus MCP server is running over stdio
    And the corpus index contains at least 10 ingested documents

  @must @smoke
  Scenario: manifest resource is registered at corpus://manifest with auto-load annotation
    Given an MCP client connected over stdio
    When the client issues resources/list
    Then a resource at uri "corpus://manifest" appears in the response
    And the resource is annotated for auto-load at session start

  @must @negative
  Scenario: manifest resource is not exposed at any non-canonical URI
    Given an MCP client connected over stdio
    When the client issues resources/list
    Then no resource at "corpus://manifest.json" or "/manifest" appears
    And only the canonical "corpus://manifest" URI serves manifest content

  @must @boundary
  Scenario: manifest on freshly initialized empty corpus returns zero counts
    Given a corpus initialized via `corpus init` with no ingested documents
    When the client reads "corpus://manifest"
    Then the doc_count field is 0
    And the established_domains field is an empty list
    And the last_ingest_timestamp field is null

  @must @smoke
  Scenario: taxonomy resource enumerates established domains and tags with counts
    Given the corpus has at least 3 established domains and 5 established tags
    When the client reads "corpus://taxonomy"
    Then each established domain appears with an integer document_count
    And each established tag appears with an integer document_count
    And no proposed (unpromoted) terms appear in the response

  @must @negative
  Scenario: taxonomy resource excludes proposed-only terms
    Given the corpus has 2 proposed but unpromoted tags from prior classifications
    When the client reads "corpus://taxonomy"
    Then neither proposed tag appears in the response
    And only established (promoted) terms are listed

  @must @boundary
  Scenario: taxonomy on empty corpus returns empty domain and tag lists
    Given a corpus with zero ingested documents
    When the client reads "corpus://taxonomy"
    Then the domains field is an empty list
    And the tags field is an empty list

  @must @smoke
  Scenario: recent-ingests resource lists most recent successful ingests
    Given 25 documents have been ingested in the last 24 hours
    And the configured recent window is 10
    When the client reads "corpus://recent"
    Then the response contains exactly 10 entries
    And the entries are ordered by ingest_timestamp descending
    And each entry contains title, domain, tags, and ingest_timestamp

  @must @negative
  Scenario: recent-ingests resource excludes failure-lane documents
    Given 5 documents are in the failure lane
    And 5 documents have been successfully ingested
    When the client reads "corpus://recent"
    Then only the 5 successfully ingested documents appear
    And no failure-lane documents are listed

  @must @boundary
  Scenario: recent-ingests on empty corpus returns empty list
    Given a corpus with zero successful ingests
    When the client reads "corpus://recent"
    Then the response is an empty list

  @must @smoke
  Scenario: per-document resource at corpus://docs/{id} returns normalized body and frontmatter
    Given a document with id "doc-abc123" exists in the corpus
    When the client reads "corpus://docs/doc-abc123"
    Then the response body is normalized Markdown
    And the response includes structured YAML frontmatter
    And the frontmatter contains id, source_path, ingest_timestamp, mime_type, and hash

  @must @negative
  Scenario: per-document resource for unknown id returns structured not-found error
    Given no document with id "doc-missing" exists in the corpus
    When the client reads "corpus://docs/doc-missing"
    Then the response is a structured MCP error
    And the error code is "document_not_found"

  @must @boundary
  Scenario: SearchHit URIs returned by corpus.find dereference exactly to per-document resource URIs
    Given a corpus.find call returns 5 SearchHits
    When each SearchHit's uri field is read as an MCP resource
    Then each read succeeds
    And each returned document id matches the SearchHit's URI path component

  @must @error
  Scenario: per-document resource read while index is locked returns retriable error
    Given the SQLite index is locked by an in-progress writer
    When the client reads "corpus://docs/{any_existing_id}"
    Then the response is a structured MCP error with code "index_locked"
    And the error envelope marks the failure as retriable


# ═══════════════════════════════════════════════════════════════════════════════

Feature: MCP prompt templates
  # Covers requirements: FR-009
  # Source opportunity:   OPP-001

  As an MCP-aware agent
  I want reusable prompt templates instructing me when to call corpus.find
  So that knowledge-grounded queries reliably consult the corpus

  Background:
    Given the corpus MCP server is running over stdio

  @must @smoke
  Scenario: server registers at least one retrieval prompt template
    Given an MCP client connected over stdio
    When the client issues prompts/list
    Then the response contains at least one prompt template
    And at least one template's description references invoking corpus.find before answering

  @must @negative
  Scenario: prompts/list never returns an empty list when retrieval template is required
    Given an MCP client connected over stdio
    When the client issues prompts/list
    Then the response list length is at least 1
    And no template is silently dropped due to load failure

  @must @boundary
  Scenario: registered prompt template includes structured instruction for knowledge-grounded questions
    Given the prompts/list response contains the retrieval prompt template
    When the client requests the template body
    Then the body contains an explicit instruction to invoke corpus.find before answering
    And the body references the corpus://manifest resource as a freshness signal


# ═══════════════════════════════════════════════════════════════════════════════

Feature: Inbox watcher and ingest pipeline
  # Covers requirements: FR-010, FR-011, FR-017
  # Source opportunity:   OPP-008

  As a corpus user
  I want to drop files into an inbox and have them validated, normalized, and ingested
  So that adding knowledge requires zero further interaction

  Background:
    Given the corpus MCP server is running with watcher enabled
    And the configured inbox directory is empty

  @must @smoke
  Scenario: file dropped into inbox is enqueued for ingest after passing validation
    Given the inbox is empty
    When a file "notes.md" of size 12 KB with extension ".md" is dropped into the inbox
    Then a queue event "ingest.enqueued" is emitted within 5 seconds
    And the event references the source path of the dropped file

  @must @negative
  Scenario: file with disallowed extension is rejected at validation gate
    Given the inbox is empty
    When a file "binary.exe" is dropped into the inbox
    Then no "ingest.enqueued" event is emitted
    And a "ingest.rejected" event with reason "disallowed_extension" is emitted
    And the file does not enter the pipeline

  @must @boundary
  Scenario: file at maximum allowed size passes validation
    Given the configured max file size is 50 MB
    When a file of exactly 50 MB with allowed extension is dropped into the inbox
    Then the file passes validation
    And an "ingest.enqueued" event is emitted

  @must @error
  Scenario: file exceeding max size is rejected with structured diagnostic
    Given the configured max file size is 50 MB
    When a file of 51 MB with allowed extension is dropped into the inbox
    Then no "ingest.enqueued" event is emitted
    And the file is routed to the failure lane with reason "exceeds_max_size"

  @must @smoke
  Scenario: PDF document is normalized to Markdown body with structured YAML frontmatter
    Given a PDF "paper.pdf" with extractable text is enqueued
    When the normalize stage completes
    Then the persisted document body is Markdown
    And the frontmatter contains id, source_path, ingest_timestamp, mime_type "application/pdf", and content hash

  @must @negative
  Scenario: HTML document with unsupported encoding is routed to failure lane
    Given an HTML file with an unrecognized text encoding is enqueued
    When the normalize stage runs
    Then the document is routed to the failure lane
    And the failure-lane diagnostic names the stage "extract" and error_code "encoding_unsupported"

  @must @boundary
  Scenario: plain-text file with zero bytes normalizes to an empty Markdown body
    Given a zero-byte plain-text file is enqueued and passes validation
    When the normalize stage completes
    Then the persisted document body is empty Markdown
    And the frontmatter is fully populated including content hash of empty string

  @must @smoke
  Scenario: identical file dropped twice short-circuits via content-hash idempotency
    Given the inbox has accepted file "report.pdf" and ingest completed
    When the same file "report.pdf" is dropped into the inbox again
    Then the pipeline detects matching content hash
    And the second submission is recorded as a no-op
    And no duplicate document or index row is created

  @must @negative
  Scenario: same logical file with modified content produces a new document
    Given file "report.pdf" was previously ingested with hash H1
    When file "report.pdf" with modified content (hash H2) is dropped into the inbox
    Then the second submission ingests as a new document
    And both documents are independently retrievable via their stable URIs

  @must @boundary
  Scenario: identical content under different filenames is detected as duplicate
    Given a file with content hash H is ingested under name "a.md"
    When a file with identical content hash H is dropped under name "b.md"
    Then the second submission short-circuits as a no-op
    And no second document is created

  @must @error
  Scenario: filename failing sanity check is rejected before content read
    Given the inbox watcher is running
    When a file with a path traversal sequence in its name is dropped into the inbox
    Then no file content is read
    And an "ingest.rejected" event with reason "filename_invalid" is emitted


# ═══════════════════════════════════════════════════════════════════════════════

Feature: Local LLM classification
  # Covers requirements: FR-012, FR-013, FR-014
  # Source opportunity:   OPP-003, OPP-007

  As the ingest pipeline
  I want a local LLM to classify documents into schema-valid metadata
  So that retrieval has reliable structured facets and the system stays cost-free

  Background:
    Given the local Ollama service is running
    And a normalized document is awaiting classification

  @must @smoke
  Scenario: classifier emits schema-valid metadata via grammar-constrained generation
    Given the classifier is configured with a Zod-derived JSON Schema for {domain, tags, summary, confidence}
    When the classifier processes a document
    Then the response is structurally valid against the schema by construction
    And the Ollama format parameter is set to the JSON Schema

  @must @negative
  Scenario: classifier without grammar constraint configuration refuses to start
    Given the classifier configuration is missing the JSON Schema format parameter
    When the server attempts to initialize the classifier
    Then initialization fails with error "classifier_schema_required"
    And the server does not begin accepting ingest jobs

  @must @boundary
  Scenario: classifier handles document with maximum-length content within token budget
    Given a document at the maximum token-budget length supported by the configured model
    When the classifier processes the document
    Then the response is schema-valid
    And the response includes a confidence value in [0.0, 1.0]

  @must @smoke
  Scenario: schema-validated classifier output is written to frontmatter
    Given the classifier returns valid metadata for document "doc-001"
    When the validator passes the response
    Then the document's frontmatter is updated with domain, tags, summary, and confidence
    And the document advances to the embed stage

  @must @negative
  Scenario: schema-invalid classifier output routes document to failure lane (no silent coercion)
    Given the classifier returns a payload that fails schema validation
    When the validator runs
    Then the document is routed to the failure lane
    And the failure-lane diagnostic includes stage "classify" and error_code "schema_validation_failed"
    And the frontmatter is not modified
    And the document does not advance to embed

  @must @error
  Scenario: validator does not coerce missing required fields
    Given the classifier returns metadata missing the required "domain" field
    When the validator runs
    Then the document is routed to the failure lane
    And no default value is silently inserted for domain

  @must @smoke
  Scenario: classifier accepts established vocabulary and emits established values directly
    Given the established domains list contains "ml-systems"
    And the established tags list contains "retrieval", "vector-search"
    When the classifier processes a document semantically about ml-systems retrieval
    Then the frontmatter domain field is "ml-systems"
    And the frontmatter tags include "retrieval"
    And no proposed-domain or proposed-tag fields are populated

  @must @negative
  Scenario: classifier MUST NOT silently introduce a never-seen term into established field
    Given the established domains list does not contain "biology"
    When the classifier returns "biology" as a domain candidate
    Then the candidate appears in facet_domain_proposed (not facet_domain)
    And the established domain field is unset or set only to a known established value

  @must @boundary
  Scenario: classifier proposes new term via separate proposed facet without polluting established
    Given the established tags list contains "retrieval" but not "graphrag"
    When the classifier suggests "graphrag" as a tag
    Then the established tags field contains only previously-established values
    And the facet_tags_proposed field includes "graphrag"

  @must @error @nfr-reliability
  Scenario Outline: vocabulary validation across input cases
    Given the established vocabulary lists are loaded
    When the classifier returns "<domain_value>" as domain and "<tags_value>" as tags
    Then the established domain field is "<established_domain_result>"
    And the proposed_domain field is "<proposed_domain_result>"
    And the document routing is "<routing>"

    Examples:
      | domain_value | tags_value           | established_domain_result | proposed_domain_result | routing       |
      | ml-systems   | retrieval            | ml-systems                |                        | embed         |
      | biology      | bio-tagged           |                           | biology                | embed         |
      |              |                      |                           |                        | failure_lane  |
      | ml-systems   | invalid-tag-format!  | ml-systems                |                        | failure_lane  |

  @must @error
  Scenario: Ollama service unavailable routes documents to failure lane with retriable flag
    Given the Ollama service is not reachable on its configured port
    When the classifier attempts to process a document
    Then the document is routed to the failure lane
    And the diagnostic error_code is "classifier_unavailable"
    And the diagnostic retriable flag is true


# ═══════════════════════════════════════════════════════════════════════════════

Feature: Embedding and indexing
  # Covers requirements: FR-015
  # Source opportunity:   OPP-001

  As the ingest pipeline
  I want classified documents embedded and indexed for hybrid retrieval
  So that corpus.find can rank them via dense vectors, keywords, frontmatter, and graph edges

  Background:
    Given the corpus MCP server is running
    And a classified document with valid frontmatter is awaiting embedding

  @must @smoke
  Scenario: classified document is embedded and inserted into single SQLite index
    Given a classified document advances to the embed stage
    When the embed and index stages complete
    Then a dense vector row is inserted into sqlite-vec
    And keyword tokens are inserted into the FTS5 index
    And frontmatter facets are inserted into the facet table
    And graph edges are inserted into the edge table
    And all rows reside in a single SQLite database file

  @must @negative
  Scenario: embedding model failure routes document to failure lane and skips index write
    Given the configured local embedding model is unavailable
    When the embed stage runs for a document
    Then the document is routed to the failure lane with error_code "embedding_unavailable"
    And no partial rows are written to the FTS5 or vector tables for this document

  @must @boundary
  Scenario: zero-content document still produces deterministic index rows
    Given a document with empty Markdown body but valid frontmatter
    When the embed and index stages complete
    Then a vector row is written for the empty content embedding
    And keyword tokens table has zero rows for this document
    And the document is retrievable via frontmatter facet filter


# ═══════════════════════════════════════════════════════════════════════════════

Feature: Pipeline idempotency and resumability
  # Covers requirements: FR-016a, FR-016b
  # Source opportunity:   OPP-008

  As the corpus operator
  I want pipeline stages to be idempotent and resumable
  So that crashes, retries, and replays never produce duplicates or partial state

  Background:
    Given the corpus MCP server is running
    And a 50-document test set is queued for ingest

  @must @smoke
  Scenario: re-running a stage on the same input produces identical persistent state
    Given the embed stage has completed for document "doc-001"
    When the embed stage is re-executed for "doc-001"
    Then the index contains exactly one vector row for "doc-001"
    And the index contains exactly one set of FTS5 tokens for "doc-001"
    And no duplicate frontmatter entry exists

  @must @negative
  Scenario: re-running validate stage does not enqueue a duplicate ingest job
    Given the validate stage has accepted "doc-002" and enqueued it once
    When the validate stage is re-executed for "doc-002"
    Then no second ingest job is enqueued
    And the queue length is unchanged

  @must @boundary
  Scenario: each pipeline stage is independently idempotent across all 5 stages
    Given a document has progressed through validate, extract, classify, embed, and index
    When each stage is re-executed exactly once in any order
    Then the final persistent state is identical to a single end-to-end run
    And no duplicate rows exist in any table

  @must @smoke
  Scenario: process killed mid-classify resumes from per-stage checkpoint on restart
    Given documents are mid-pipeline at the classify stage
    When the process is killed with SIGTERM
    And the process is restarted
    Then the pipeline resumes from the last successful checkpoint per document
    And no documents are duplicated in the final index
    And no documents are silently dropped

  @must @negative
  Scenario: kill before extract checkpoint leaves no partial frontmatter writes
    Given a document is mid-extract when the process is killed
    When the process restarts
    Then the document's frontmatter file is either fully written or not written at all
    And no partial-write artifact remains on disk

  @must @boundary
  Scenario: per-stage checkpoint is recorded only after stage success
    Given a document fails mid-classify with a transient error
    When the process restarts
    Then the document resumes at the classify stage (not embed)
    And the checkpoint table shows the document's last successful stage as "extract"

  @must @error
  Scenario: corrupted checkpoint file forces full pipeline re-run for affected document
    Given the checkpoint file is corrupted for "doc-099"
    When the process restarts
    Then "doc-099" is re-processed from the validate stage
    And idempotency guarantees ensure no duplicates result


# ═══════════════════════════════════════════════════════════════════════════════

Feature: Failure lane
  # Covers requirements: FR-018
  # Source opportunity:   OPP-008

  As the corpus operator
  I want failed ingests routed to a structured failure lane
  So that I can triage without a UI and replay after correction

  Background:
    Given the corpus MCP server is running
    And the failure lane is empty

  @must @smoke
  Scenario: failed pipeline stage routes document to failure lane with structured diagnostic
    Given a document fails the classify stage with error_code "schema_validation_failed"
    When the failure handler runs
    Then the document appears in the failure lane
    And the diagnostic record contains stage, error_code, message, retriable flag, and source pointer

  @must @negative
  Scenario: failed documents do NOT enter the searchable index
    Given 5 documents have failed the classify stage
    When corpus.find is invoked with queries matching their content
    Then none of the failed documents appear in any SearchHit list

  @must @boundary
  Scenario: failure lane is inspectable via both filesystem and corpus://failures resource
    Given 3 documents are in the failure lane
    When the user lists the failure-lane filesystem directory
    Then 3 diagnostic records are listed
    When the MCP client reads "corpus://failures"
    Then the same 3 records are returned with identical structured fields

  @must @error
  Scenario: failure-lane writes are durable across crashes
    Given a document fails and a failure-lane record write begins
    When the process is killed mid-write
    And the process restarts
    Then the failure-lane record is either fully present or absent (no partial)
    And on absent, the original document re-enters the pipeline and re-fails reproducibly


# ═══════════════════════════════════════════════════════════════════════════════

Feature: User workflows
  # Covers requirements: UR-001, UR-002, UR-003
  # Source opportunity:   OPP-008, OPP-001, OPP-002

  As a primary persona (Maya P-001 or David P-002)
  I want to drop files, ask grounded questions, and have the corpus persist across sessions
  So that the system feels like an effortless extension of my agent

  Background:
    Given the corpus MCP server is installed and registered with the user's agent client
    And the agent (Claude Code) has an active session with the server attached

  @must @smoke
  Scenario: dropped document becomes queryable on next matching query without further action
    Given the inbox is empty
    When persona Maya drops a Markdown file "ideas.md" with content about "graph retrieval" into the inbox
    And the agent waits for ingest to complete
    And the agent invokes corpus.find with query "graph retrieval"
    Then "ideas.md" appears in the SearchHit list
    And no manual command was required between drop and queryability

  @must @negative
  Scenario: dropped document that fails classification is NOT silently queryable
    Given Maya drops a document that fails the classify stage
    When the agent invokes corpus.find with a query matching the document's text
    Then the failed document does not appear in the SearchHit list
    And the document is visible in corpus://failures for triage

  @must @boundary
  Scenario: dropped document becomes queryable within the configured ingest budget
    Given Maya drops a 5-page Markdown file
    When the configured per-doc ingest budget elapses
    Then the document is queryable via corpus.find

  @must @smoke
  Scenario: agent invokes corpus.find and grounds answer with traceable references
    Given the corpus contains documents relevant to a knowledge-grounded question
    When persona David asks the agent the question
    Then the agent invokes corpus.find at least once
    And the answer cites at least one corpus://docs/{id} URI from the SearchHit list
    And each cited URI dereferences to an actual document in the corpus

  @must @negative
  Scenario: agent does not fabricate corpus citations when corpus.find returns empty
    Given corpus.find returns zero SearchHits for the user's query
    When the agent generates its answer
    Then no corpus://docs/{id} citation appears in the answer
    And the agent indicates corpus did not contain a match

  @must @boundary
  Scenario: cross-document grounding works when SearchHits span multiple documents
    Given corpus.find returns 5 SearchHits across 5 distinct documents for one query
    When the agent grounds its answer
    Then citations from at least 2 distinct documents appear in the answer

  @must @smoke
  Scenario: install once, available across new agent sessions via auto-loaded resources
    Given the corpus is installed once via `corpus init`
    When the user opens a new agent session 24 hours later
    Then the manifest, taxonomy, and recent-ingests resources are auto-loaded at session start
    And no per-session reconfiguration is required
    And no re-feed of corpus content is required

  @must @negative
  Scenario: opening a new session does not duplicate corpus state
    Given the user opens 3 agent sessions back-to-back
    When each session reads "corpus://manifest"
    Then doc_count and timestamps are identical across all 3 sessions
    And no duplicate registration of the corpus.find tool occurs

  @must @error
  Scenario: agent session started before corpus init returns a clear unavailable error
    Given `corpus init` has never been run
    When an agent session attempts to attach to the corpus MCP server
    Then the connection fails with a clear error message naming "corpus not initialized"
    And the error message includes the next-step `corpus init` command


# ═══════════════════════════════════════════════════════════════════════════════

Feature: Install and uninstall
  # Covers requirements: TR-001, TR-002
  # Source opportunity:   OPP-004

  As a new user
  I want a single install command and a reversible uninstall
  So that adoption and removal carry no operational tax

  Background:
    Given a clean machine without prior corpus installation

  @must @smoke
  Scenario: single `corpus init` command provisions server, index, and inbox in XDG layout
    Given the user runs `corpus init` once
    When the command exits
    Then an XDG-compliant config directory is created
    And an XDG-compliant data directory is created
    And an XDG-compliant state directory is created
    And an empty SQLite index file exists in the data directory
    And the inbox directory exists
    And the user's MCP-client config has been updated to register the corpus server
    And next-step instructions are printed to stdout

  @must @negative
  Scenario: re-running `corpus init` on existing install does not destroy user data
    Given a corpus install with 100 ingested documents already exists
    When the user runs `corpus init` a second time
    Then the existing index file is preserved
    And the existing inbox contents are preserved
    And the command prints a "already initialized" notice

  @must @boundary
  Scenario: install requires zero multi-step manual configuration
    Given a clean machine
    When the user runs `corpus init`
    Then no follow-up manual config-file edits are required
    And the corpus.find tool is invokable from a new agent session immediately after init

  @must @error
  Scenario: install on machine without write permission to XDG dirs fails with clear error
    Given the user has no write permission to the XDG config directory
    When the user runs `corpus init`
    Then the command exits non-zero with a clear permission-denied error
    And no partial directory layout is left behind

  @must @smoke
  Scenario: `corpus uninstall` removes server registration but preserves user data by default
    Given a corpus install with 100 ingested documents and an inbox of 10 pending files
    When the user runs `corpus uninstall`
    Then the MCP-server registration is removed from the agent-client config
    And the SQLite index file is preserved
    And the inbox directory and its contents are preserved
    And the documents' frontmatter files are preserved

  @must @negative
  Scenario: `corpus uninstall` does NOT remove user data without explicit destructive flag
    Given a corpus install with ingested documents
    When the user runs `corpus uninstall` without any flag
    Then no document, index, or frontmatter file is deleted

  @must @boundary
  Scenario: `corpus uninstall --purge` removes user data only with explicit destructive flag
    Given a corpus install with ingested documents
    When the user runs `corpus uninstall --purge`
    Then the MCP-server registration is removed
    And the index file is deleted
    And ingested documents and frontmatter files are deleted


# ═══════════════════════════════════════════════════════════════════════════════

Feature: Local-only enforcement
  # Covers requirements: NFR-001, NFR-002
  # Source opportunity:   OPP-005

  As the project security stance
  I want compile-time and runtime enforcement of zero outbound network calls on the privileged-data path
  So that local-only is enforced by construction, not policy

  Background:
    Given the repository CI pipeline is configured

  @must @nfr-security @smoke
  Scenario: CI lint passes when no forbidden network imports exist in pipeline or adapter packages
    Given the pipeline and adapter packages contain no forbidden network imports
    When the CI lint job runs
    Then the lint job exits with status 0
    And the forbidden_imports_in_pipeline_or_adapter_packages count is 0

  @must @nfr-security @negative
  Scenario: CI lint fails the build when a forbidden network import is added to pipeline package
    Given a developer adds an import of node:http to a pipeline source file
    When the CI lint job runs on the PR
    Then the lint job exits non-zero
    And the failure message names the offending file and import

  @must @nfr-security @boundary
  Scenario Outline: forbidden import detection across import patterns
    Given the lint scans the pipeline and adapter packages
    When a file in those packages contains "<import_form>"
    Then the lint result is "<lint_result>"

    Examples:
      | import_form                                           | lint_result |
      | import { fetch } from 'undici'                        | fail        |
      | import http from 'node:http'                          | fail        |
      | import https from 'node:https'                        | fail        |
      | import { OpenAI } from 'openai'                       | fail        |
      | import { S3Client } from '@aws-sdk/client-s3'         | fail        |
      | import Database from 'better-sqlite3'                 | pass        |
      | import { parse } from 'node:path'                     | pass        |

  @must @nfr-security @error
  Scenario: lint runs on every PR (not just main)
    Given a PR is opened against any branch
    When CI is triggered for the PR
    Then the local-only lint job is included in the required checks
    And the PR cannot merge if the lint job fails

  @must @nfr-security @cf-2 @refines-a-007
  Scenario: Runtime egress audit for privileged-data path
    Given a sentinel privileged document
    And tcpdump capturing all non-loopback interfaces
    When the document is ingested, classified, indexed, and queried via corpus.find
    Then zero outbound packets to non-loopback addresses are observed
    And egress.blocked telemetry events are emitted for any disallowed-host attempts

  @must @nfr-security @negative
  Scenario: integration test fires HTTP to disallowed host and asserts blocking + audit
    Given the runtime egress guard is active
    When an integration test inside the server process attempts an HTTP request to a non-loopback host
    Then the request is blocked at the in-process Node hook
    And an "egress.blocked" telemetry event is emitted with destination host
    And no packet for the request appears on any non-loopback interface

  @must @nfr-security @boundary
  Scenario: in-process Node hook blocks undici dispatcher AND raw net.Socket connect
    Given the runtime egress guard is active
    When test code attempts a raw net.Socket connect to a non-loopback address
    Then the connect is blocked
    When test code attempts an undici dispatcher request to a non-loopback host
    Then the request is blocked
    And both attempts produce "egress.blocked" telemetry events

  @must @nfr-security @error
  Scenario: OS-level pf/iptables defense-in-depth blocks egress under MCP server UID
    Given the OS firewall is configured with the documented pf/iptables rules for the MCP server UID
    When a process running under the MCP server UID attempts an outbound non-loopback connection
    Then the connection is blocked at the OS layer
    And a corresponding egress.blocked telemetry event records the OS-level deny


# ═══════════════════════════════════════════════════════════════════════════════

Feature: Performance baselines
  # Covers requirements: NFR-003, NFR-014, NFR-015
  # Source opportunity:   OPP-001, OPP-004, OPP-008

  As the corpus user
  I want corpus.find, first-run setup, and crash recovery to meet research-baselined targets
  So that the system feels responsive and resilient

  Background:
    Given the reference hardware (Apple M-series Mac, 32 GB RAM) is in use
    And the corpus index uses a single SQLite file with sqlite-vec extension

  @must @nfr-performance @smoke
  Scenario: corpus.find p95 latency at 5k docs is at most 250 ms
    Given the corpus index contains exactly 5000 documents
    And the SQLite page cache is warm
    When the 100-query synthetic benchmark via better-sqlite3 harness runs
    Then the p95 latency for corpus.find is at most 250 milliseconds

  @must @nfr-performance @smoke
  Scenario: corpus.find p50 latency at 5k docs is at most 100 ms
    Given the corpus index contains exactly 5000 documents
    And the SQLite page cache is warm
    When the 100-query synthetic benchmark runs
    Then the p50 latency for corpus.find is at most 100 milliseconds

  @must @nfr-performance @boundary
  Scenario: corpus.find latency budget is measured at 5k-doc corpus, not smaller
    Given the benchmark harness asserts corpus size before measurement
    When the harness sees fewer than 5000 indexed documents
    Then the harness fails fast with "insufficient_corpus_size"
    And no latency measurement is reported

  @must @nfr-performance @error
  Scenario: cold-cache run is reported separately and does not satisfy the warm-cache budget
    Given the SQLite page cache is cold (process just started)
    When the benchmark runs
    Then the cold-cache p95 measurement is recorded under a separate label
    And it is NOT compared against the 250 ms warm-cache budget

  @must @nfr-usability @smoke
  Scenario: first-run setup completes in at most 90 seconds end-to-end
    Given a clean Linux or macOS machine with Node 18+ available
    When the user runs `npx <pkg> init`
    And ingests a single seed document
    And invokes corpus.find with a matching query
    Then the elapsed wall-clock time from `npx` to first SearchHit is at most 90 seconds

  @must @nfr-usability @negative
  Scenario: first-run setup does not require Docker or a compile step
    Given a clean machine without Docker installed
    When the user runs `npx <pkg> init`
    Then the command succeeds without invoking docker
    And no native compilation step is required

  @must @nfr-usability @error
  Scenario: first-run setup on machine without Node 18+ exits with clear remediation
    Given a clean machine with Node 16 installed
    When the user runs `npx <pkg> init`
    Then the command exits non-zero
    And the error message names the required Node version

  @must @nfr-reliability @smoke
  Scenario: SQLite WAL recovery on reopen completes in at most 2 seconds for WAL <100 MB
    Given the SQLite WAL file is at most 100 MB
    And the WAL was truncated mid-write to simulate ungraceful shutdown
    When the database is reopened
    Then WAL replay completes within 2000 milliseconds wall-clock
    And PRAGMA integrity_check passes

  @must @nfr-reliability @boundary
  Scenario: WAL recovery time remains within budget at the 100 MB upper bound
    Given the WAL file is exactly 100 MB
    When the database is reopened after simulated crash
    Then WAL replay completes within 2000 milliseconds


# ═══════════════════════════════════════════════════════════════════════════════

Feature: Pipeline reliability
  # Covers requirements: NFR-004, NFR-005
  # Source opportunity:   OPP-003, OPP-008

  As the corpus operator
  I want the classifier to produce schema-valid output 100% of the time on benchmark
  And the pipeline to survive SIGKILL at any stage without corruption
  So that I trust ingest to be deterministic and crash-resilient

  Background:
    Given the corpus MCP server is running
    And benchmark harnesses are available

  @must @nfr-reliability @smoke
  Scenario: classifier produces schema-valid output on 100% of 100-document benchmark
    Given the 100-document benchmark spans all supported MIME types
    When the classifier (FR-012) processes every document
    And every response is validated against the Zod schema
    Then 100 out of 100 responses are schema-valid

  @must @nfr-reliability @negative
  Scenario: a single schema-invalid classifier response in benchmark fails the NFR
    Given 99 of 100 benchmark documents produce schema-valid classifier output
    And 1 produces schema-invalid output
    When the NFR-004 metric is computed
    Then the schema_valid_classifier_output_rate metric is 99 percent
    And the NFR is reported as failed

  @must @nfr-reliability @smoke
  Scenario: pipeline survives SIGKILL at each of 5 stages on 50-doc run with no duplicate ingest
    Given a 50-document test set
    When SIGKILL is sent to the pipeline process during each of validate, extract, classify, embed, and index stages across 5 trials
    And the process is restarted after each kill
    Then all 50 documents complete ingest exactly once across each trial
    And the index contains no duplicate rows
    And the SQLite PRAGMA integrity_check returns 0 incidents

  @must @nfr-reliability @negative
  Scenario: SIGKILL during classify stage produces no orphaned embedding rows
    Given a document is mid-classify when SIGKILL fires
    When the process restarts
    Then no embedding row exists for the document until classification completes
    And no FTS5 token row exists for the document until classification completes

  @must @nfr-reliability @boundary
  Scenario: SIGKILL across multiple trials accumulates zero index corruption incidents
    Given 5 SIGKILL trials have been run
    When PRAGMA integrity_check runs after each trial
    Then the cumulative index_corruption_after_kill metric is exactly 0 incidents

  @must @nfr-reliability @error
  Scenario: SIGKILL during index commit leaves SQLite in valid WAL-recoverable state
    Given a document is mid-index-write when SIGKILL fires
    When the process restarts
    Then SQLite WAL recovery completes successfully
    And no half-written index row is visible to subsequent corpus.find calls


# ═══════════════════════════════════════════════════════════════════════════════

Feature: Failure lane usability
  # Covers requirements: NFR-006
  # Source opportunity:   OPP-008

  As the corpus operator (Shon)
  I want failure-lane diagnostics rich enough to triage without a UI
  So that AG-001 (no human-facing UI) holds in real 30-day operational use

  Background:
    Given the corpus MCP server has been in real use for at least 30 days

  @must @nfr-usability @smoke
  Scenario: every failure-lane entry contains stage, error_code, message, source pointer, retriable flag
    Given the failure lane contains at least one entry
    When the operator reads any entry
    Then the entry has all of stage, error_code, message, source pointer, and retriable flag
    And no field is null or absent

  @must @nfr-usability @e2e
  Scenario: 100% of failure-lane interactions in 30-day use are resolved via CLI or agent (no missing-UI blocker)
    Given the 30-day Shon-with-Claude-Code use period has completed
    When each failure-lane interaction is classified as resolved-via-CLI-or-agent or blocked-on-missing-UI
    Then the resolved-via-CLI-or-agent rate is 100 percent
    And the blocked-on-missing-UI count is 0

  @must @nfr-usability @negative
  Scenario: failure-lane entries that lack a source pointer are detected by validation
    Given a failure-lane writer omits the source_pointer field
    When the failure-lane validator runs
    Then the write is rejected and the writer is logged as buggy
    And the diagnostic record is not persisted in malformed form


# ═══════════════════════════════════════════════════════════════════════════════
# CARRY-FORWARD CROSS-AGENT FEATURE (Stage 1 handoff CF-1, CF-3)
# ═══════════════════════════════════════════════════════════════════════════════

Feature: Cross-agent parity (CF carry-forwards)
  # Covers requirements: NFR-007, NFR-008
  # Source opportunity:   OPP-004, OPP-006
  # Stage 1 carry-forwards CF-1 and CF-3 — should-priority per AG-004

  As the project quality gate
  I want cross-agent retrieval parity and absolute local-LLM tool-use rate verified
  So that AG-004 portability claims and CF-3 absolute-target framing both hold

  @should @cf-1 @refines-a-006
  Scenario: Cross-agent retrieval quality parity
    Given a corpus snapshot with 1000 documents
    And a 20-query shared script with known relevance judgments
    When corpus.find is invoked from Claude Code MCP for each query
    And corpus.find is invoked from Gemini CLI MCP for each query
    Then the top-3 SearchHit URIs from each agent have Jaccard similarity >= 0.7

  @should @cf-3 @refines-a-008
  Scenario: Local-LLM tool-use rate is an absolute target, not relative-to-cloud
    Given an Ollama-served llama3 model with the corpus MCP server attached
    And a 100-query knowledge-grounded benchmark script
    When the model processes each query
    Then the count of corpus.find tool invocations per 100 queries meets the absolute floor set at Plan stage
    And the threshold is documented as ABSOLUTE (NOT relative to any cloud-LLM baseline)


# ═══════════════════════════════════════════════════════════════════════════════
# END OF FEATURE BLOCKS
# ═══════════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════════
# SHOULD-HAVE COVERAGE (added pre-handoff per Council Condition #1)
# Each should-have requirement gets at least one happy-path scenario; some
# get a negative scenario where the failure mode is non-obvious.
# ═══════════════════════════════════════════════════════════════════════════════

Feature: Dynamic taxonomy promotion
  # Covers requirements: FR-019
  # Source opportunity:   OPP-007

  Background:
    Given the corpus MCP server is running
    And the established tags list does NOT contain "graphrag"

  @should @smoke
  Scenario: proposed term auto-promotes to established after N independent ingests
    Given the configured promotion threshold N is 3
    When 3 independent documents are classified with "graphrag" in facet_tags_proposed
    Then "graphrag" is auto-promoted to the established tags list
    And the promotion event is logged with timestamp and source document ids
    And the taxonomy resource at corpus://taxonomy now lists "graphrag" with document_count 3

  @should @negative
  Scenario: promotion does not fire below threshold
    Given the configured promotion threshold N is 3
    When 2 independent documents are classified with "graphrag" in facet_tags_proposed
    Then "graphrag" remains in the proposed-only state
    And no promotion event is logged
    And corpus://taxonomy does NOT list "graphrag"


# ═══════════════════════════════════════════════════════════════════════════════

Feature: URL inbox source
  # Covers requirements: FR-020
  # Source opportunity:   OPP-008

  @should @smoke
  Scenario: corpus add accepts a URL and ingests the response body as a document
    Given the corpus MCP server is running with URL ingest enabled
    When the user runs `corpus add https://example.org/article.html`
    Then the URL is fetched once at submission time
    And the response body is normalized to Markdown and ingested through the standard pipeline
    And the document's frontmatter contains the original URL in a source_url field
    And the document is queryable via corpus.find on next matching query


# ═══════════════════════════════════════════════════════════════════════════════

Feature: corpus.health diagnostic resource
  # Covers requirements: FR-021
  # Source opportunity:   OPP-008

  @should @smoke
  Scenario: corpus.health exposes pipeline counters and failure-lane size
    Given the corpus MCP server is running with at least 100 ingested documents
    And 3 documents are in the failure lane
    When an MCP client reads "corpus://health"
    Then the response contains pipeline_throughput counters per stage
    And the response contains failure_lane_size with value 3
    And the response contains index_doc_count with value at least 100
    And the response contains last_ingest_timestamp with a non-null ISO-8601 value


# ═══════════════════════════════════════════════════════════════════════════════

Feature: Cross-agent portability (FR-022, FR-023)
  # Covers requirements: FR-022, FR-023
  # AG-004: portability property only — should-priority

  @should @smoke
  Scenario: corpus MCP server is invocable from a non-Claude-Code MCP client
    Given the corpus MCP server is running over stdio
    When a Gemini CLI MCP client connects to the server
    And invokes corpus.find with any valid query
    Then a SearchHit list is returned with the same schema as Claude Code receives
    And no transport-specific failure occurs

  @should @smoke
  Scenario: corpus MCP server is invocable from an Ollama-served local LLM
    Given the corpus MCP server is running over stdio
    And an Ollama-served llama3 (or qwen3) model with MCP tool-use support is connected
    When the model invokes corpus.find
    Then a SearchHit list is returned in the standard MCP response shape
    And the model can dereference SearchHit URIs to read corpus://docs/{id} resources


# ═══════════════════════════════════════════════════════════════════════════════

Feature: User re-classification and failed-ingest replay
  # Covers requirements: UR-004, UR-005

  @should @smoke
  Scenario: user re-classifies an existing document on demand
    Given a document "doc-099" was previously classified
    When the user runs `corpus reclassify doc-099`
    Then classify, embed, and index stages re-run for "doc-099"
    And the previous index rows for "doc-099" are atomically replaced
    And no duplicate document or index row exists post-reclassification

  @should @smoke
  Scenario: user replays a failed ingest after correcting source
    Given a document is in the failure lane with error_code "extract_failed"
    When the user corrects the source file and runs `corpus replay <doc-id>`
    Then the document re-enters the pipeline at the appropriate stage (extract)
    And the failure-lane entry is moved to a resolved-history record on success


# ═══════════════════════════════════════════════════════════════════════════════

Feature: Performance and observability NFRs
  # Covers requirements: NFR-009, NFR-010, NFR-011, NFR-016

  @should @nfr-performance
  Scenario: classifier wall-clock per document meets single-stream and concurrent budgets
    Given the local Ollama service is running Qwen 2.5 7B Q4_K_M on M-series Mac 32GB
    When the 100-document benchmark runs with single-stream classifier
    Then the p95 classifier_wall_clock_per_doc is at most 5000 ms
    When the same benchmark runs with OLLAMA_NUM_PARALLEL=2
    Then the classifier throughput is at least 30 docs per minute

  @should @nfr-maintainability
  Scenario: index storage is exactly one SQLite file
    Given the corpus is initialized via corpus init
    When the 100-document benchmark completes ingest+index
    Then ls of the index directory shows exactly one SQLite database file
    And no auxiliary index files (separate vector store, separate FTS file) exist outside that single file
    # (SQLite WAL/SHM sidecars are part of the same logical database and are accepted)

  @should @nfr-observability
  Scenario: every pipeline stage transition emits exactly one structured log event
    Given the corpus MCP server is running with structured event logging enabled
    When 50 documents are ingested through all 5 pipeline stages
    Then for each (document, stage, outcome) triple exactly one log event is emitted
    And each event contains doc_id, stage, outcome, duration_ms, and timestamp fields

  @should @nfr-observability
  Scenario: telemetry layer emits at least 6 named event classes
    Given the corpus MCP server is running for 1 hour of mixed real-use load
    When the telemetry NDJSON log is scanned
    Then events of class query.executed are present
    And events of class ingest.completed are present
    And events of class classification.failed are present
    And events of class egress.blocked are present
    And events of class index.rebuilt are present
    And events of class mcp.tool_invoked are present
    And the telemetry layer made zero outbound HTTP requests during the hour


# ═══════════════════════════════════════════════════════════════════════════════
# QATESTER ADVERSARY FIXES (Council Condition #2 — high-severity findings F-1, F-6, F-12, F-13, F-15)
# These scenarios close the smallest-passing-impl gaps surfaced by the Stage 2
# QATester adversary pass; severity high unless noted.
# ═══════════════════════════════════════════════════════════════════════════════

Feature: Hybrid ranking signal-attribution adversary tests
  # Covers requirements: FR-003, FR-012, NFR-003
  # Closes QATester findings F-1, F-6, F-13

  @must @adversary @f-1
  Scenario: disabling any single ranking signal measurably changes top-K results
    Given the corpus index contains 1000 documents covering a 100-query benchmark
    When the full 4-signal ranking is computed for the 100-query benchmark
    And the ranking is recomputed 4 times — once with each of BM25, dense, graph, confidence ablated
    Then for each ablation the Kendall tau between full ranking and ablated ranking is below 0.95
    # Proves no signal is silently a no-op weight

  @must @adversary @f-6
  Scenario: classifier produces schema-valid output on first generation attempt with retry_count=0
    Given the classifier is configured with grammar-constrained generation enabled
    And a stress prompt designed to elicit invalid JSON without grammar
    When the classifier is invoked with retry_count=0 and post-hoc-retry disabled
    Then the response is schema-valid on the first generation attempt
    And no retry was performed
    # Proves grammar is at the token-generation level, not post-hoc retry

  @must @adversary @f-13
  Scenario: corpus.find p95 latency holds on unseen query distribution with no result memoization
    Given the corpus index contains exactly 5000 documents
    And the page cache is warm but the result-cache layer is verified absent via instrumentation hook
    And 100 benchmark queries are drawn from a 10000-query distribution unseen by the server
    When the benchmark runs
    Then the p95 latency for corpus.find is at most 250 milliseconds
    And no result-memoization layer fired (instrumentation reports zero result-cache hits)


# ═══════════════════════════════════════════════════════════════════════════════

Feature: NFR-002 broader egress coverage (Council Condition #2 — F-12 + David objection)
  # Covers requirements: NFR-002
  # Closes F-12 (dgram/DNS/http2/tls coverage) AND David persona objection (always-on, all docs)

  @must @nfr-security @adversary @f-12
  Scenario Outline: in-process Node hook blocks all outbound network primitives
    Given the runtime egress guard is active
    When test code attempts an outbound connection via "<primitive>"
    Then the attempt is blocked at the in-process hook
    And an "egress.blocked" telemetry event records the destination and primitive
    And no packet for the attempt appears on any non-loopback interface

    Examples:
      | primitive                                      |
      | net.Socket.connect to 8.8.8.8:53               |
      | undici Dispatcher to https://example.org       |
      | dgram.createSocket UDP to 8.8.8.8:53           |
      | dns.lookup against external resolver 1.1.1.1   |
      | http2.connect to https://example.org           |
      | tls.connect to example.org:443                 |

  @must @nfr-security @david-objection
  Scenario: in-process egress hook is active during ALL operations on ALL documents (not sentinel-only)
    Given the runtime egress guard is configured
    When the corpus MCP server starts
    Then the egress hook is registered before the first ingest, classify, embed, index, or find call
    And the hook remains active for the entire process lifetime
    And telemetry asserts at least one egress.checkpoint event per stage transition for every document processed during a 50-document mixed-workload run
    # Proves the guard is not a sampled spot-check on a sentinel doc only — David's privileged-corpus model requires always-on


# ═══════════════════════════════════════════════════════════════════════════════

Feature: Failure-lane usability denominator floor (Council Condition #2 — F-15)
  # Covers requirements: NFR-006

  @must @nfr-usability @adversary @f-15
  Scenario: NFR-006 metric requires minimum N=10 failure-lane events before computing rate
    Given the 30-day Shon-with-Claude-Code measurement window has elapsed
    When fewer than 10 failure-lane events occurred during the window
    Then the failure_lane_actionable_without_UI rate is reported as "inconclusive — denominator below threshold"
    And the NFR is NOT marked as passed
    When 10 or more failure-lane events occurred during the window
    Then the rate is computed and reported with passed/failed status against the 100% target
    # Closes denominator-zero Goodhart attack on NFR-006


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE-3 VALIDATE CARRY-FORWARD ADVERSARY TESTS (C-018/C-019/C-020 closures)
# Added 2026-04-26 per Stage 4 PM-Review carry-forward concern C-033 (sonnet Council QA finding).
# Closes QATester findings F-5, F-8, F-10 deferred from Stage 2.
# ═══════════════════════════════════════════════════════════════════════════════

Feature: Stage-3 carry-forward adversary tests (C-018/C-019/C-020 closures)
  # Covers requirements: FR-010, FR-016a, FR-017
  # Closes QATester findings F-5, F-8, F-10

  @must @adversary @f-5
  Scenario: binary file with allowlisted extension rejected at MIME-sniff (FR-010 mime_mismatch)
    Given the inbox accepts files with extensions in {.md, .txt, .pdf, .html} per ADR-007
    And the validation gate runs MIME-sniff via the file-type package after extension check per D-011
    When a file named "document.md" is dropped into the inbox
    And the file's binary header indicates a Mach-O executable (not text/markdown)
    Then the file is rejected at the validation gate
    And the failure-lane diagnostic has error_code "mime_mismatch"
    And the failure-lane diagnostic message names both the declared extension and the detected MIME type
    # Closes C-018 (high-severity QATester finding F-5)

  @must @adversary @f-8
  Scenario: concurrent invocations of the same pipeline stage on the same document produce exactly one row
    Given a 50-document fixture loaded into the inbox
    And the per-stage checkpoint table has UNIQUE constraint on (doc_id, stage) per ADR-003
    When the same pipeline stage is invoked twice in parallel for the same doc_id
    Then exactly one row exists in the per-stage checkpoint table for that (doc_id, stage)
    And the second invocation's INSERT no-ops via ON CONFLICT DO NOTHING (per D-010)
    And no duplicate work product (classification, embedding, index entry) is produced
    # Closes C-019 (high-severity QATester finding F-8)

  @must @adversary @f-10
  Scenario: 60MB files identical in first 1MB but differing in tail are ingested as separate documents
    Given two files file_A.bin and file_B.bin, each 60MB
    And the first 1MB of file_A and file_B are byte-identical
    And the remaining 59MB differ
    When both files are dropped into the inbox
    Then content-hash deduplication uses streaming SHA-256 over the FULL file (per ADR-002 / D-009)
    And both files are ingested as separate documents with distinct doc_ids
    And the index contains exactly 2 rows for these two source files
    # Closes C-020 (high-severity QATester finding F-10)
