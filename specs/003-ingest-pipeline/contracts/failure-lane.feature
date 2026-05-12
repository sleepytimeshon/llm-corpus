# Gherkin contract — Failure-lane primitive: every rejection produces structured sidecar
# Feature: 003-ingest-pipeline
# Source FRs: FR-INGEST-007
# Source SCs: SC-INGEST-010 (.error.json contract), SC-INGEST-011 (no documents row for failed entries),
#             SC-INGEST-002 (three-folder routing invariants)

Feature: Structured failure-lane routing with .error.json sidecars
  As the SP-003 pipeline
  I want every rejection or pipeline error to produce a sibling .error.json sidecar
  So that SP-006 can later expose failures via corpus://failures and replay via corpus drain --retry-failed

  Background:
    Given Paths.failed() exists
    And the documented .error.json schema is enforced (FR-INGEST-007)

  Scenario: Every failed-lane file has exactly one sidecar
    Given the test workload drops 10 files spanning every rejection class
    When ingest completes for all
    Then every entry in Paths.failed() has a sibling Paths.failed() + "/<filename>.error.json"
    And no orphan sidecars (sidecar without parent file) exist
    And no orphan parent files (parent without sidecar) exist

  Scenario: Sidecar contains all required fields and is valid JSON
    Given a file routed to Paths.failed() for any reason
    When the sidecar is inspected
    Then the sidecar file parses as valid JSON
    And the parsed object has fields: error_code, message, retriable, source_path, stage, timestamp
    And error_code is a member of the documented enum
    And retriable is a boolean
    And stage is one of: validate, normalize, persist
    And timestamp is a valid ISO-8601 UTC string

  Scenario: error_code enum coverage spans every rejection class
    Given the test workload covers every error_code in FR-INGEST-007's enum
    When sidecars are aggregated across the test run
    Then each of these error_codes appears at least once:
      | error_code                  |
      | filename_sanity_failed      |
      | mime_not_allowlisted        |
      | mime_mismatch               |
      | size_exceeded               |
      | file_unstable               |
      | extract_failed              |
      | normalize_failed            |
      | persist_failed              |
      | telemetry_write_failed      |
      | aborted                     |

  Scenario: Sidecar write is atomic (Constitution VIII)
    Given a file is being routed to Paths.failed()
    When the sidecar is written
    Then the write uses tmp + fsync + rename + dirsync semantics
    And on SIGTERM mid-write, the partial sidecar is cleaned up
    And no incomplete sidecar JSON appears on disk

  Scenario: NO documents row with status='success' for any failed-lane entry
    Given the test workload produces N entries in Paths.failed()
    When the documents table is queried after the drain run
    Then ZERO rows have status='success' AND source_path matching any failed-lane entry's source_path
    And the integrity invariant holds across the entire test surface

  Scenario: Three-folder routing invariant — pending/ is empty after drain
    Given a mixed-workload run with successes, dedups, and failures
    When the drain run completes (drain lock released)
    Then Paths.pending() contains ZERO files
    And every Paths.processed() file has a corresponding documents row with status='success'
    And every Paths.failed() file has a sidebar AND no status='success' row
    And the invariant is asserted by post-drain reconciliation in tests/integration/three-folder-routing.test.ts

  Scenario: Stage field disambiguates where the failure occurred
    Given files producing each of the error_codes above
    When the sidecars are inspected
    Then error_code "filename_sanity_failed" → stage "validate"
    And error_code "mime_not_allowlisted" → stage "validate"
    And error_code "mime_mismatch" → stage "validate"
    And error_code "size_exceeded" → stage "validate"
    And error_code "file_unstable" → stage "normalize" (hashing happens at normalize boundary)
    And error_code "extract_failed" → stage "normalize"
    And error_code "normalize_failed" → stage "normalize"
    And error_code "persist_failed" → stage "persist"
    And error_code "telemetry_write_failed" → stage "persist" (only telemetry append failure routes here)
    And error_code "aborted" → stage matching the in-flight stage

  Scenario: retriable flag is consistent with error_code semantics
    Given the test surface
    When sidecars are aggregated
    Then permanent rejections (filename_sanity, mime_not_allowlisted, mime_mismatch, size_exceeded, extract_failed, normalize_failed) have retriable = false
    And transient failures (file_unstable, persist_failed, telemetry_write_failed, aborted) have retriable = true
    And SP-006's corpus drain --retry-failed will replay only the retriable=true entries

  Scenario: Failed file content is preserved verbatim for forensics
    Given a file "evil.docx" routed to Paths.failed()
    When the parent file is inspected
    Then the file bytes in Paths.failed() are byte-identical to the dropped Paths.inbox() bytes
    And no normalization or transformation has touched the file content
