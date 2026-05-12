# Gherkin contract — Per-MIME normalization to Markdown + YAML frontmatter
# Feature: 003-ingest-pipeline
# Source FRs: FR-INGEST-006, FR-INGEST-008
# Source SCs: SC-INGEST-001 (normalized body files), SC-INGEST-003 (FR-008 frontmatter), SC-INGEST-020 (no agent-derived content)
# Source ADRs: ADR-007 (normalizer selections)
# Plan decisions: F (pdf-parse via runTool), G (turndown), I (canonical body layout)

Feature: Pipeline normalizes accepted documents to Markdown body + YAML frontmatter
  As the SP-003 pipeline
  I want deterministic per-MIME normalization to a canonical Markdown+frontmatter shape
  So that SP-002 resource readers return a uniform shape regardless of input MIME

  Background:
    Given a Pending File at Paths.pending() + "/<filename>" with detected_mime in the allowlist
    And the file has been hash-verified and is NOT a dedup hit

  Scenario: Markdown input passes through normalization preserving body verbatim
    Given a Pending File "notes.md" of 50 KB with valid Markdown body
    And the file has NO existing frontmatter delimiters
    When the normalizer for text/markdown is invoked
    Then the body bytes are passed through verbatim (byte-identical to input)
    And the frontmatter object contains the FR-008 minimum surface (id, source_path, ingest_timestamp, mime_type, hash)
    And the resulting body file at Paths.docsStore() + "/<id-prefix>/<doc-id>.md" begins with "---\n" (frontmatter delimiter)
    And NO subprocess is invoked
    And a telemetry event "ingest.normalized" is emitted

  Scenario: Markdown with existing frontmatter preserves body but rewrites frontmatter
    Given a Pending File "with-fm.md" containing "---\nauthor: shon\n---\nbody text\n"
    When the normalizer for text/markdown is invoked
    Then the body portion ("body text\n") is preserved
    And the output frontmatter contains the FR-008 minimum surface
    And the user-supplied "author: shon" key is preserved (frontmatter is .passthrough())

  Scenario: Plain-text input wraps in minimal Markdown structure preserving body verbatim
    Given a Pending File "raw.txt" of 5 KB containing UTF-8 plain text
    When the normalizer for text/plain is invoked
    Then the body is the input text wrapped in minimal Markdown (no heading injection unless trivial)
    And the body bytes (post-frontmatter) are byte-identical to the input text
    And the frontmatter mime_type is "text/plain"
    And NO subprocess is invoked

  Scenario: HTML input converts via turndown with frozen rule set
    Given a Pending File "article.html" of 80 KB containing well-formed HTML
    When the normalizer for text/html is invoked
    Then turndown is invoked in-process with the default rule set
    And NO turndown plugins or custom rules are loaded
    And the output Markdown body is byte-identical across two runs on the same input (determinism)
    And a telemetry event "ingest.normalized" is emitted
    And NO subprocess is invoked

  Scenario: PDF input extracts via pdf-parse subprocess through runTool (Constitution XII)
    Given a Pending File "paper.pdf" of 5 MB containing valid PDF bytes
    When the normalizer for application/pdf is invoked
    Then runTool is invoked with binary "node" and args including "tools/pdf-extractor/extract.mjs"
    And the subprocess receives AbortSignal from the per-doc AbortController
    And the per-doc timeout is the policy's perDocTimeoutMs (60s interactive / 300s batch)
    And a telemetry event "tool_invoked" is emitted with binary name "node" (NOT full args)
    And on subprocess success the stdout-written body file is read into the normalizer
    And the body file at Paths.docsStore() is the normalized Markdown wrapping of the extracted PDF text

  Scenario: PDF extractor subprocess timeout routes to failed/ with extract_failed
    Given a malicious PDF that causes pdf-parse to hang
    And the per-doc timeout is 60s
    When runTool invokes the extractor
    Then after 60s the subprocess is killed via SIGKILL
    And runTool returns Result.err(ToolInvocationError) with code "TIMEOUT"
    And the file routes to Paths.failed() with error_code "extract_failed", retriable false
    And a telemetry event "persist.failed" is emitted with severity "error"

  Scenario: PDF extractor subprocess OOM routes to failed/
    Given a malicious PDF that OOMs the subprocess's 512 MB heap cap
    When runTool invokes the extractor
    Then the subprocess exits non-zero
    And runTool returns Result.err(ToolInvocationError)
    And the file routes to Paths.failed() with error_code "extract_failed"
    And the main daemon's heap is UNAFFECTED

  Scenario: Body file write is atomic via withTempDir (Constitution VIII)
    Given normalization produces a body string
    When the persister writes the body file to Paths.docsStore() + "/<id-prefix>/<doc-id>.md"
    Then the write uses tmp + fsync + rename + dirsync semantics via withTempDir
    And the temp file is in Paths.cache() (NEVER /tmp or os.tmpdir)
    And the rename target NEVER overwrites a pre-existing file
    And on exception or SIGTERM the tmp file is cleaned up

  Scenario: Frontmatter id matches documents.id (integrity contract)
    Given a Pending File results in doc_id "doc-ab12cd34"
    When the body file is written
    Then the YAML frontmatter "id" field equals "doc-ab12cd34"
    And the SP-002 fetchDocument reader confirms frontmatter.id === documents.id when read

  Scenario: NO LLM content is introduced (Constitution II / SC-INGEST-020)
    Given a Pending File of any allowed MIME type
    When normalization completes
    Then the body file content is byte-identical to the deterministic normalization of the source bytes
    And NO LLM, summarization, or AI-generated content appears in the body
    And the frontmatter MUST NOT contain origin, provenance_*, confidence, captured_at, or "corpus capture" fields
