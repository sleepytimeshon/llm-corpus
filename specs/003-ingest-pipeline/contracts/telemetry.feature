# Gherkin contract — Telemetry: ≥6 distinct classes, schema-validated, honest on write failure
# Feature: 003-ingest-pipeline
# Source FRs: FR-INGEST-009, FR-INGEST-010 (cancellable IO touches telemetry on abort), FR-INGEST-011 (lock contention emits)
# Source SCs: SC-INGEST-012, SC-INGEST-013, SC-INGEST-014, SC-INGEST-015
# Source NFR: NFR-016 (≥6 named telemetry event classes)
# Source Principles: V (schema), IX (≤4096 byte append-atomic), XIII (telemetry-or-die)

Feature: SP-003 pipeline emits ≥6 named telemetry event classes covering success + failure paths
  As the SP-003 pipeline
  I want every state transition to emit a Zod-validated structured event to Paths.telemetry()
  So that operators (Shon) can triage ingest behavior without inspecting logs or filesystem state

  Background:
    Given Paths.telemetry() is writable
    And the TelemetryEvent Zod discriminated union has been extended with 14 SP-003 event classes (PREREQ-003)

  Scenario: Mixed-workload run produces ≥6 distinct named event classes (NFR-016)
    Given a fixture-driven workload of 25+ files spanning:
      | 10 | valid happy-path files (PDF, MD, TXT, HTML mix) |
      | 5  | disallowed-MIME files                          |
      | 5  | mime-mismatch files                            |
      | 3  | oversize files                                 |
      | 2  | filename-invalid files                         |
      | 5  | duplicates of already-ingested content         |
    When the drain run completes
    Then at least 6 distinct event_class values appear in Paths.telemetry()
    And the union of distinct classes includes ALL of:
      | inbox.allowlist_hit       |
      | inbox.allowlist_miss      |
      | inbox.mime_mismatch       |
      | inbox.size_exceeded       |
      | ingest.dedup_hit          |
      | ingest.dedup_miss         |
      | ingest.normalized         |
      | ingest.completed          |
    And every event includes envelope fields: event_class, timestamp, severity, outcome

  Scenario: Every emitted event validates against the canonical Zod schema
    Given any SP-003 event has been appended to Paths.telemetry()
    When the test harness reads Paths.telemetry() line by line
    Then every line parses as valid JSON
    And every parsed event validates against TelemetryEvent (the Zod discriminated union)
    And ZERO events fail schema validation
    And ZERO events appear with a missing required field

  Scenario: Telemetry append is atomic and within ≤4096-byte budget (Constitution IX)
    Given any SP-003 event class
    When emitTelemetry serializes and appends the event
    Then JSON.stringify(event).length is ≤ 4096 bytes (POSIX PIPE_BUF)
    And exceeding the budget throws TelemetrySizeExceededError before write
    And the append is a single O_APPEND fs.appendFile call (atomic on POSIX)

  Scenario: Document body content NEVER appears in telemetry (Constitution I + SC-INGEST-014)
    Given a fixture document containing a unique sentinel string "FIXTURE_CANARY_PHRASE"
    When the document is ingested and telemetry events emitted
    Then a grep over Paths.telemetry() for "FIXTURE_CANARY_PHRASE" returns ZERO matches
    And the assertion holds across every SP-003 event class
    And hashes, ids, paths, MIME types, sizes are permitted

  Scenario: Telemetry-write failure routes in-flight ingest to failed/ (SC-INGEST-013 honest-failure)
    Given an in-flight ingest of "valid.md"
    And the filesystem holding Paths.telemetry() is remounted read-only mid-ingest (test harness)
    When the next emitTelemetry call inside the ingest path fires
    Then the emitTelemetry call throws (filesystem ENOENT/EROFS)
    And the in-flight document routes to Paths.failed() with error_code "telemetry_write_failed", retriable true
    And the exception is observable to the caller (NOT silently swallowed)
    And the system does NOT silently complete the ingest
    And a best-effort sentinel telemetry event (if path becomes writable) records the routing decision

  Scenario: Every catch block emits telemetry before re-throwing (Constitution XIII)
    Given any SP-003 source file under packages/{pipeline,extract,storage,contracts}/
    When code-search lint scans the source
    Then every catch block emits a structured telemetry event before re-throwing or converting to Result.err
    And the severity matches the actual error severity (no downgrading errors to "info"/"debug")
    And the SP-001 AST-level catch-block lint covers SP-003 source files

  Scenario: tool_invoked telemetry emits for PDF subprocess (Constitution XII)
    Given a PDF file is being normalized
    When runTool invokes "tools/pdf-extractor/extract.mjs"
    Then a "tool_invoked" telemetry event is emitted
    And the event payload includes binary name "node" and exit_code
    And the event payload does NOT include the full args array (Constitution XII)

  Scenario: pipeline.lock_contention emits when concurrent drain attempts overlap (FR-INGEST-011)
    Given a drain process A holds the Paths.drainLock() flock
    When a second drain process B attempts to acquire the lock with LOCK_NB
    Then B observes EWOULDBLOCK
    And B emits a "pipeline.lock_contention" telemetry event with severity "info"
    And B exits cleanly with exit code 0
    And A continues processing files normally
    And ZERO double-ingests occur (SC-INGEST-015)

  Scenario: ingest.aborted emits on SIGTERM during in-flight ingest (FR-INGEST-010 / SC-INGEST-016)
    Given an in-flight ingest of "big.pdf" mid-extraction
    When the daemon receives SIGTERM
    Then the master AbortController fires
    And the in-flight ingest emits "ingest.aborted" with stage indicating where it was
    And the file routes to Paths.failed() with error_code "aborted", retriable true
    And the daemon exits within 2 seconds

  Scenario: Severity discipline — error events are emitted at severity "error"
    Given a persist.failed event is emitted
    When the event is inspected
    Then severity equals "error"
    And the event is NOT downgraded to "info" or "warn" to silence alerts (Constitution XIII)

  Scenario: One event per state transition per document (FR-INGEST-009)
    Given a single valid file completes ingest
    When telemetry is inspected for that doc_id
    Then exactly one "inbox.allowlist_hit" event references the file_path
    And exactly one "ingest.dedup_miss" event references the hash
    And exactly one "ingest.normalized" event references the doc_id
    And exactly one "ingest.completed" event references the doc_id
    And no event is emitted twice for the same transition
