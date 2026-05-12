# Gherkin contract — Validation gate: filename sanity → extension → MIME-sniff → size
# Feature: 003-ingest-pipeline
# Source FRs: FR-INGEST-002, FR-INGEST-007
# Source SCs: SC-INGEST-007, SC-INGEST-008, SC-INGEST-009, SC-INGEST-010, SC-INGEST-011
# Source ADRs: ADR-007 (MIME allowlist)
# Source edge cases: "Empty file", filename sanity rules

Feature: Validation gate enforces fixed-order checks before any content read past the cutoff
  As the SP-003 pipeline
  I want a single validation gate that short-circuits on the first failure
  So that disallowed inputs never consume bytes past the cutoff and never create documents rows

  Background:
    Given a clean corpus is initialized
    And the MIME allowlist is {application/pdf, text/markdown, text/plain, text/html}
    And the configured max_file_size_mb is 100

  Scenario: Happy path — file passes all four gates and atomic-moves to pending/
    Given a file "valid.md" of 50 KB containing valid Markdown bytes
    When the validation gate is invoked
    Then the filename sanity check passes
    And the extension check matches ".md" in the allowlist
    And the MIME sniff returns "text/markdown" matching the extension family
    And the size check passes (50 KB ≤ 100 MB)
    And the file atomically moves to Paths.pending() + "/valid.md"
    And a telemetry event "inbox.allowlist_hit" is emitted
    And NO ".error.json" sidecar is written

  Scenario: Disallowed extension routes to failed/ with mime_not_allowlisted
    Given a file "doc.docx" of 50 KB
    When the validation gate is invoked
    Then the filename sanity check passes
    And the extension check fails (".docx" not in allowlist)
    And the file routes to Paths.failed() + "/doc.docx"
    And a sibling Paths.failed() + "/doc.docx.error.json" sidecar is written atomically
    And the sidecar contains error_code "mime_not_allowlisted", retriable false, stage "validate"
    And a telemetry event "inbox.allowlist_miss" is emitted with severity "warn"
    And NO documents row is created
    And NO file content past the magic-byte cutoff is read

  Scenario: MIME mismatch — .md extension with %PDF magic bytes (ADR-007 / C-018 F-5)
    Given a file "looks-md.md" whose first bytes are "%PDF" binary content
    When the validation gate is invoked
    Then the filename sanity check passes
    And the extension check passes (.md in allowlist)
    And the MIME sniff returns "application/pdf" (NOT text/markdown)
    And the extension/MIME mismatch is detected
    And the file routes to Paths.failed() with error_code "mime_mismatch"
    And the sidecar records both the extension ".md" and the detected MIME "application/pdf"
    And a telemetry event "inbox.mime_mismatch" is emitted
    And NO documents row is created

  Scenario: Size exactly at max passes (boundary inclusion)
    Given a file "exact-max.pdf" of exactly 100 MB
    And max_file_size_mb is 100
    When the validation gate is invoked
    Then the size check passes (file <= 100 MB)
    And the file atomically moves to Paths.pending()
    And NO size-exceeded telemetry is emitted

  Scenario: Size one byte over max routes to failed/ with bounded-IO discipline
    Given a file "over-max.pdf" of exactly (100 MB + 1) bytes
    When the validation gate is invoked
    Then the size check fails
    And the file routes to Paths.failed() with error_code "size_exceeded"
    And a telemetry event "inbox.size_exceeded" is emitted
    And the system reads at most (max_file_size + 1) bytes from the file before rejecting
    And NO documents row is created

  Scenario: Filename sanity — null byte in name rejected before content read
    Given a file with a filename containing a null byte
    When the validation gate is invoked
    Then the filename sanity check fails
    And the file routes to Paths.failed() with error_code "filename_sanity_failed"
    And ZERO bytes of file content are read (Constitution VII bounded-IO)
    And a telemetry event "inbox.filename_sanity_failed" is emitted

  Scenario: Filename sanity — path-traversal sequence rejected
    Given a file with filename "../../escape.md"
    When the validation gate is invoked
    Then the filename sanity check fails
    And the file routes to Paths.failed() with error_code "filename_sanity_failed"

  Scenario: Filename sanity — empty name rejected
    Given a file with a zero-length filename
    When the validation gate is invoked
    Then the filename sanity check fails
    And the file routes to Paths.failed() with error_code "filename_sanity_failed"

  Scenario: Empty file (0 bytes) — passes validation, normalizes to empty body (edge case)
    Given a file "empty.txt" of 0 bytes
    When the validation gate is invoked
    Then the filename sanity passes
    And the extension check passes (.txt allowed)
    And the MIME sniff returns text/plain
    And the size check passes (0 ≤ 100 MB)
    And the file atomically moves to Paths.pending()
    And subsequent ingest produces a documents row with hash = SHA-256(empty bytes)
    And the body file at Paths.docsStore() + "/<id-prefix>/<doc-id>.md" exists with a minimal Markdown wrapping

  Scenario: Fixed gate ordering — earlier gate failure short-circuits later gates
    Given a file with a null-byte filename AND binary disallowed content
    When the validation gate is invoked
    Then the filename sanity check fires first and short-circuits
    And the extension / MIME / size checks are NOT invoked
    And the error_code recorded is "filename_sanity_failed" (NOT "mime_not_allowlisted")
