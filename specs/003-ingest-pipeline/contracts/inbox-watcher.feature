# Gherkin contract — Inbox watcher detection + initial-scan + atomic-rename
# Feature: 003-ingest-pipeline
# Source FRs: FR-INGEST-001
# Source SCs: SC-INGEST-001 (partial — happy-path detection), SC-INGEST-002 (post-drain pending/ empty)
# Source edge cases: "Watcher misses a file due to fast write", "Drop-during-init",
#                    "Filesystem watcher resource limits", "Inbox subdirectory traversal"

Feature: Inbox watcher detects new files in Paths.inbox()
  As the SP-003 daemon
  I want a filesystem watcher monitoring Paths.inbox()
  So that user-dropped files are detected and enqueued for ingest without further user action

  Background:
    Given a clean corpus is initialized
    And the SP-003 daemon is started with batchPolicy
    And Paths.inbox() exists and is empty
    And Paths.pending() exists and is empty

  Scenario: User drops a single PDF via atomic rename (FR-INGEST-001 happy path)
    Given the watcher is in awaitWriteFinish stable state
    When the user atomically renames "/tmp/foo.pdf" into Paths.inbox() + "/foo.pdf"
    Then within 1 second the watcher emits an "add" event for "foo.pdf"
    And the validation gate is invoked with absolute path Paths.inbox() + "/foo.pdf"
    And a telemetry event "inbox.allowlist_hit" is appended with severity "info"

  Scenario: Initial-scan picks up files dropped between init and watcher activation
    Given Paths.inbox() contains "/preexisting1.md" and "/preexisting2.txt" before daemon start
    When the SP-003 daemon starts
    Then within 5 seconds both files are detected
    And each file's validation gate is invoked exactly once
    And no file is silently skipped due to the watcher being absent during the drop

  Scenario: Fast write — stat-and-recheck stability defense (edge case)
    Given the user writes a file via "cat large.pdf > inbox/foo.pdf" (non-atomic)
    When the watcher emits the initial "add" event
    Then awaitWriteFinish polls the file size every 100ms
    And the "add" handler does not proceed until the size has been stable for 500ms
    And a stat-recheck before reading the file confirms size has not changed
    And if size differs between the pre-read and post-read stat, the file routes to Paths.failed() with error_code "file_unstable"

  Scenario: Subdirectory file is NOT detected (FR-INGEST-001 v1 scope)
    Given Paths.inbox() + "/subdir/" exists
    When the user drops "buried.pdf" into Paths.inbox() + "/subdir/buried.pdf"
    Then the watcher does NOT emit an "add" event
    And no documents row is created
    And the file remains in Paths.inbox() + "/subdir/" untouched

  Scenario: inotify watch-limit exhaustion routes to honest failure (edge case)
    Given the system's fs.inotify.max_user_watches limit has been reached
    When the SP-003 daemon attempts to start the watcher
    Then a "ENOSPC" error is detected
    And a telemetry event "inbox.watcher_resource_exhausted" with severity "error" is emitted
    And the daemon exits with a non-zero status code
    And the daemon does NOT silently degrade to a partial-coverage watch

  Scenario: Watcher detects file dropped via scp
    Given the watcher is in awaitWriteFinish stable state
    When an scp command lands "remote.md" at Paths.inbox() + "/remote.md"
    Then within 1 second the watcher emits an "add" event for "remote.md"

  Scenario: Watcher releases resources on SIGTERM
    Given the watcher is monitoring Paths.inbox()
    When the daemon receives SIGTERM
    Then the watcher's underlying inotify / FSEvents handle is closed
    And the master AbortController fires its abort signal
    And in-flight ingests route to Paths.failed() with error_code "aborted"
    And the daemon exits within 2 seconds (Constitution VII)
