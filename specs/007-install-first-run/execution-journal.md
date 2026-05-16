# SP-007 Execution Journal — NFR-006 Failure-Lane CLI Triage

**Sprint**: 007-install-first-run
**Spec section**: NFR-006 (failure lane is 100% resolvable via CLI)
**Coverage**: SC-007-023, SC-007-024

This journal documents the CLI triage path for every failure mode listed in
`.product/ACCEPTANCE-CRITERIA.feature` lines 1076-1417. Each entry names the
sidecar stage, error_code, observable signature, triage steps using only the
SP-007 CLI surface, and resolution.

## SC-007-024 Preamble (the honest N≥10 disclaimer)

Per SC-007-024, the "100%-resolved-via-CLI rate" metric is **NOT** computed
until ≥ 10 real failure-lane events have been triaged on a production
installation. SP-007 ships ≥ 10 scenarios below as the contract; the metric
becomes meaningful only after operators accumulate ≥ 10 real triage outcomes
through `corpus failures` + `corpus taxonomy promote` + `corpus reenrich`.
The integration test `tests/integration/failure-lane-cli-triage.test.ts`
drives ≥ 10 distinct error_codes through the CLI triage path against fixture
sidecars; this validates the CLI surface, not the field-rate metric.

## Triage Path — Quick Reference

```
$ corpus failures list                        # paginated table
$ corpus failures list --stage=classify       # filter
$ corpus failures list --since=2026-05-10T00:00:00Z --limit=20
$ corpus failures list --json                 # for piping
$ corpus failures show <doc-id>               # full JSON sidecar
$ corpus taxonomy promote --axis=<v> --term=<t>   # for vocab violations
$ corpus reenrich <doc-id>                    # SP-005 CLI; re-classify
```

The `corpus failures` CLI is read-only by construction; nothing it does
mutates index state. Resolution always passes through one of the existing
mutation surfaces (`corpus taxonomy promote`, `corpus reenrich`, manual
`vi <body-path>`).

---

## Scenarios

### S-1: classify stage — vocabulary violation (domain)

**Stage**: `classify`
**error_code**: `vocab_violation`
**Trigger**: SP-004 classifier rejects a domain term that is not present
in `taxonomy_terms WHERE state='established'`.

**Triage**:
```
$ corpus failures show doc-12345678
{ "stage": "classify", "error_code": "vocab_violation",
  "message": "unknown domain term: climbing", "retriable": true, ... }
$ corpus taxonomy promote --axis=domain --term=climbing
$ corpus reenrich doc-12345678
```

**Resolution**: SP-006 recovery scanner removes the sidecar on the next
daemon restart; SP-005 reindex covers the doc on next pass.

### S-2: classify stage — vocabulary violation (type)

**Stage**: `classify`
**error_code**: `vocab_violation`
**Trigger**: SP-004 classifier rejects a `type` term.

**Triage**: identical to S-1 with `--axis=type --term=<t>`.

### S-3: classify stage — vocabulary violation (tag)

**Stage**: `classify`
**error_code**: `vocab_violation`
**Triage**: identical to S-1 with `--axis=tag --term=<t>`.

### S-4: classify stage — vocabulary violation (source_type)

**Stage**: `classify`
**error_code**: `vocab_violation`
**Triage**: identical to S-1 with `--axis=source_type --term=<t>`.

### S-5: validation stage — schema rejection

**Stage**: `validation`
**error_code**: `frontmatter_invalid`
**Trigger**: SP-002 codec rejects malformed YAML frontmatter.

**Triage**:
```
$ corpus failures show doc-87654321
$ vi /path/to/inbox/doc-87654321.md   # operator edits frontmatter
$ corpus reenrich doc-87654321
```

### S-6: hash stage — duplicate document

**Stage**: `hash`
**error_code**: `duplicate_doc`
**Trigger**: SP-003 hash check finds a doc with identical content hash.

**Triage**: typically not retriable; sidecar is informational. Operator
removes the duplicate from the inbox; sidecar can be discarded via the
SP-006 recovery scanner.

### S-7: normalize stage — text-extraction failure

**Stage**: `normalize`
**error_code**: `extraction_failed`
**Trigger**: SP-003 fails to normalize a doc (e.g., binary content).

**Triage**: typically not retriable. Operator inspects body, optionally
edits to plain text, reenriches.

### S-8: persist stage — SQLite constraint violation

**Stage**: `persist`
**error_code**: `unique_constraint_violation`
**Trigger**: SP-003 INSERT collides on `documents.id` unique constraint.

**Triage**: sidecar reveals the colliding doc_id. Operator inspects via
`corpus failures show <doc-id>` and resolves manually.

### S-9: embed stage — Ollama unreachable

**Stage**: `embed`
**error_code**: `embedder_unavailable`
**Trigger**: SP-005 embedder times out on `nomic-embed-text` call.

**Triage**:
```
$ corpus failures show doc-aaaaaaaa
$ ollama list                          # operator verifies model present
$ ollama pull nomic-embed-text         # if missing
$ corpus reenrich doc-aaaaaaaa
```

### S-10: index stage — SQLite WAL failure

**Stage**: `index`
**error_code**: `index_write_failed`
**Trigger**: SP-005 FTS5 / vec insert fails (disk full, permissions).

**Triage**:
```
$ corpus failures show doc-aaaaaaaa
$ df -h $HOME                          # operator checks disk
$ corpus reenrich doc-aaaaaaaa
```

### S-11: edges-build stage — graph-build failure

**Stage**: `edges-build`
**error_code**: `edges_build_failed`
**Trigger**: SP-005 RRF/graph builder fails for the doc.

**Triage**: `corpus failures show` → `corpus reenrich <doc-id>`.

### S-12: unrecoverable_orphan stage — kill-9 orphan

**Stage**: `unrecoverable_orphan`
**error_code**: `recovery_failed`
**Trigger**: SP-006 recovery scanner finds a sentinel row whose body file
is missing or unreadable.

**Triage**: typically not resumable. Operator inspects sidecar, optionally
re-drops the body into the inbox, then re-runs `corpus drain`.

---

## CLI surface guarantees (Constitution III)

The `corpus failures` CLI is read-only:
- Reads `Paths.failed()` via `fs.readdir` + `fs.readFile`.
- Zero SQL writes; zero filesystem writes.
- No new MCP mutation surfaces (FR-INSTALL-023, Constitution III).
- The corresponding `corpus://failures` MCP resource (SP-006) is the AI-agent
  surface; this CLI is the human-operator surface. Both are read-only.

The SP-006 recovery scanner removes the sidecar after the doc successfully
re-runs through the pipeline. Operators do NOT manually `rm` the sidecar;
the scanner is authoritative.
