# Gherkin contract — Content-hash idempotency (full-file SHA-256, ADR-002)
# Feature: 003-ingest-pipeline
# Source FRs: FR-INGEST-004, FR-INGEST-005
# Source SCs: SC-INGEST-005, SC-INGEST-006 (ADR-002 F-10 adversary)
# Source ADRs: ADR-002 (full-file SHA-256 for content-hash idempotency)

Feature: Content-hash idempotency — same content never produces duplicate documents rows
  As the SP-003 pipeline
  I want full-file SHA-256 hash as the idempotency key
  So that re-dropping identical content (same bytes) does not produce a second documents row

  Background:
    Given a clean corpus is initialized
    And the documents.hash column has a UNIQUE INDEX (PREREQ-002)

  Scenario: Same file dropped twice — second drop is dedup_hit no-op
    Given a file "paper.pdf" has been ingested with hash H and doc_id "doc-ab12cd34"
    When the same byte-identical "paper.pdf" is dropped into Paths.inbox() a second time
    Then validation passes
    And the dedup check queries documents WHERE hash = H and finds the existing row
    And a telemetry event "ingest.dedup_hit" is emitted with existing_doc_id "doc-ab12cd34"
    And NO new documents row is created
    And the duplicate file is removed from Paths.pending() (no orphaned pending entry)
    And the unique-hash INSERT constraint is NOT exercised (application-level short-circuit fires first)

  Scenario: Same content under different filename — dedup fires on hash not filename
    Given "notes.md" has been ingested with hash H
    When "notes-copy.md" (byte-identical content) is dropped into Paths.inbox()
    Then validation passes
    And the hash computation yields H
    And a telemetry event "ingest.dedup_hit" is emitted referencing the existing doc_id
    And the documents table still has exactly one row for hash H
    And the original source_path is preserved (NOT overwritten with the second filename)

  Scenario: ADR-002 F-10 adversary — 60 MB identical-prefix-different-tail files ingest separately
    Given two 60 MB files "A.bin" and "B.bin" identical in the first 1 MB but differing in the last byte
    When both are dropped into Paths.inbox()
    Then both pass validation
    And the full-file SHA-256 of A is HA
    And the full-file SHA-256 of B is HB
    And HA does NOT equal HB
    And two separate documents rows are created (one with hash HA, one with hash HB)
    And NEITHER is treated as a dedup of the other
    And NO partial-prefix hash (first-4KB-only) is used at any point

  Scenario: Hash is computed via Node crypto streaming, full file
    Given an arbitrary inbox file of size N bytes
    When the hasher runs
    Then the implementation uses crypto.createHash('sha256').update(stream).digest('hex')
    And the entire N bytes are read (NOT a partial prefix)
    And the hash matches a reference computation (e.g., openssl sha256) byte-for-byte
    And the hash is recorded in lowercase hex

  Scenario: Hash stability — file modified during hash routes to file_unstable
    Given an inbox file "fluid.md" whose content is being appended via streaming write
    When the hasher reads the file
    And a post-hash fs.stat shows the size has changed since the pre-hash stat
    Then the file routes to Paths.failed() with error_code "file_unstable", retriable true
    And a telemetry event "ingest.file_unstable" is emitted
    And NO documents row is created

  Scenario: Concurrent dedup-hit on different files does not corrupt unrelated in-flight ingest
    Given file "X.md" is mid-ingest (hash computed, normalizer running)
    When file "Y.md" is dropped and Y is a content-duplicate of an already-ingested file
    Then Y's dedup-hit decision fires independently of X's in-flight ingest
    And X's ingest completes normally
    And no row corruption or telemetry-order corruption is observed

  Scenario: Application-level dedup AND UNIQUE constraint provide defense-in-depth
    Given the application-level dedup check is bypassed (test harness simulating race)
    When the persister attempts INSERT with a duplicate hash
    Then the SQLite UNIQUE INDEX rejects the INSERT
    And a telemetry event "persist.failed" is emitted with severity "error"
    And the file routes to Paths.failed() with error_code "persist_failed"

  Scenario: Empty-file dedup is well-defined
    Given two 0-byte files dropped under different filenames
    When both pass validation
    Then both produce hash = SHA-256(empty bytes) = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    And the second is dedup'd against the first
    And a telemetry event "ingest.dedup_hit" is emitted for the second

  Scenario: Hash collision (cryptographically negligible) treated as same content per ADR-002
    Given two distinct files with the same full-file SHA-256 (hypothetical)
    When the second is processed
    Then it is treated as a dedup_hit against the first
    And the system does NOT attempt content-equality fallback (ADR-002 explicit non-goal)
