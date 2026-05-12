# Phase 0 — Research: Inbox Watcher + Ingest Pipeline

**Feature**: 003-ingest-pipeline
**Date**: 2026-05-12

This document records the plan-time architectural decisions that gate SP-003. The spec arrived clean from `/speckit-specify` (zero `[NEEDS CLARIFICATION]` markers — every Plan-deferred ambiguity is explicitly tagged in the spec's Assumptions and Edge Cases sections, not as a CLAR marker). The five decisions below are the Plan-time resolutions of those deferred items.

Format: Decision → Rationale → Alternatives considered.

---

## Decision E — Filesystem watcher backend

**Decision**: Use `chokidar ^3.6.0` as the watcher backend, configured with `awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }`, `ignoreInitial: false` (so initial-scan picks up files dropped between `corpus init` and watcher activation per FR-INGEST-001 + edge case), and `depth: 0` (top-level inbox only, no subdirectory recursion per spec Edge Case "Inbox subdirectory traversal").

**Rationale**:

- **Cross-platform shape matches v1 platform scope**: SP-003's v1 platforms are Linux (Fedora baseline) and macOS. chokidar abstracts inotify (Linux) and FSEvents (macOS, via optional `fsevents` peer) behind a single API — one watcher source file instead of two. Windows is out of scope per spec Assumptions, so the polling fallback is only relevant for macOS-without-fsevents (rare).
- **Mature dependency surface**: chokidar is used by webpack, parcel, vscode, tsc-watch. The maintenance status, issue triage, and security responsiveness are well-established. Pure JS on Linux (no native addon — uses Node's built-in `fs.watch`). The optional `fsevents` peer on macOS is a single-platform optional native addon that the project's existing native-addon allowlist already accommodates (allowlist gates by `*.node` file presence; if `fsevents` doesn't install on the user's machine, chokidar transparently falls back to polling).
- **`awaitWriteFinish` solves the partial-write race**: spec Edge Case "Watcher misses a file due to fast write" requires the watcher to stabilize on file content before reading. chokidar's `awaitWriteFinish` polls file size every `pollInterval` ms and only fires the `add` event after the size has been stable for `stabilityThreshold` ms. 500ms stability is conservative; 100ms poll keeps the daemon responsive. The stat-and-recheck logic that FR-INGEST-001 mentions runs as a defense-in-depth check inside the watcher's `add` handler (NOT a replacement for `awaitWriteFinish`).
- **Initial-scan baked in**: `ignoreInitial: false` (chokidar's default) makes the watcher emit `add` events for every file present at watcher start. This satisfies spec Edge Case "Drop-during-init" without an extra scan loop.
- **No subdirectory recursion**: `depth: 0` enforces FR-INGEST-001's "subdirectory recursion is out of scope for v1." Files inside subdirectories of `Paths.inbox()` are not detected.
- **Resource-exhaustion observability**: On Linux, `inotify` has per-user watch limits (`fs.inotify.max_user_watches`, default ~8192 on Fedora). chokidar surfaces `ENOSPC` from `fs.watch` as an error event; SP-003's watcher wraps this and emits `inbox.watcher_resource_exhausted` telemetry + the daemon exits non-zero (spec Edge Case "Filesystem watcher resource limits", FR-INGEST-001 implicit).

**Alternatives considered**:

- **Raw `inotify` via `node-inotify`**: Rejected. Linux-only (would require a separate macOS path, doubling watcher source files). `node-inotify` is a native addon with a less-active maintenance trajectory than chokidar's optional fsevents.
- **Raw `fs.watch` (Node built-in) with custom polling fallback**: Rejected. `fs.watch` has well-documented platform inconsistencies (Linux gives filename, macOS doesn't; rename detection is unreliable). Re-implementing chokidar's normalization layer is wasted effort.
- **Pure polling (no event-driven backend)**: Rejected. Detection latency would be polling-interval-bound (100ms = 10 wakeups/sec = visible CPU on idle systems). chokidar with `awaitWriteFinish` gives event-driven detection on Linux/macOS with poll-only as the fallback.
- **`@parcel/watcher`**: Considered. Faster than chokidar on some workloads; native-addon-only with a larger dependency footprint. Rejected for the v1 platform scope — chokidar's pure-JS-on-Linux + optional-fsevents-on-macOS is the cleaner allowlist story.

**Implementation guidance**: At implementation time, verify `chokidar.watch` accepts the `awaitWriteFinish` option as an object (not just boolean) — this changed across major versions. Pin to `^3.6.0` specifically; do NOT take `^4.0.0` (4.x dropped some platform fallbacks per the changelog). Document the fsevents-fallback warning path in `quickstart.md`'s troubleshooting section.

---

## Decision F — PDF extractor choice and invocation pattern

**Decision**: Use `pdf-parse ^1.1.1` for PDF text extraction, invoked via a **vendored CLI shim** at `tools/pdf-extractor/extract.mjs` through the existing `runTool` subprocess helper. The shim accepts `--in <path>` and `--out <path>` flags, parses the input PDF via `require('pdf-parse')`, writes the extracted text to the output path. The pipeline NEVER imports pdf-parse directly into the main Node process.

**Rationale**:

- **Constitution XII (Subprocess Hygiene) is end-to-end**: The principle exists to keep untrusted-input parsers out of the main process. PDF parsing is a known attack surface — malformed PDFs can OOM, hang, or trigger pathological CPU on adversarial inputs. Running pdf-parse in a subprocess (via `runTool`) gives the same isolation as the existing telemetry/subprocess discipline applies to all other untrusted-input tooling.
- **`runTool` already propagates AbortSignal + emits `tool_invoked` telemetry**: SP-001's `runTool` (verified in `packages/contracts/src/run-tool.ts`) accepts `signal`, captures stdout/stderr separately, emits `tool_invoked` with the binary name (Constitution XII). The shim invocation pattern is `runTool('node', ['tools/pdf-extractor/extract.mjs', '--in', ..., '--out', ...], { signal, timeoutMs: 60_000 })` — exactly the contract Constitution XII demands. Per-doc timeout (60s interactive, 300s batch via the policy) gives bounded execution per Constitution VII.
- **Native-addon allowlist hygiene**: pdf-parse is pure JS (no `.node` file). It depends transitively on `pdfjs-dist` (also pure JS). The vendored shim adds zero native-addon footprint. The shim's own `package.json` pins exact versions (no `^` range) so CI cannot silently take a minor-version bump.
- **OOM containment**: The shim spawns with `--max-old-space-size=512` (512 MB heap cap). pdf-parse's worst-case memory on a 60 MB PDF is well under 512 MB in normal operation; OOM crashes the subprocess (exit code non-zero) without touching the main daemon's heap. `runTool` surfaces the non-zero exit as `ToolInvocationError`, which the normalizer maps to `error_code='extract_failed', retriable=false` and routes the file to `failed/` per FR-INGEST-007.
- **Egress isolation**: pdf-parse does not make network calls in v1.1.1. The vendored shim isolates it from future versions that might add network features — pinning `pdf-parse` exactly + the SP-001 OS-firewall fallback in `runTool` (which already detects `ECONNREFUSED`/`ENETUNREACH` against non-loopback hosts and emits `egress.blocked`) catch any accidental network access.
- **Spec/ADR-007 says "or equivalent"**: ADR-007 commits to `pdf-parse OR equivalent` for PDF, leaving SP-003 to finalize. The pdf-parse choice is the conservative match to the existing dependency footprint.

**Alternatives considered**:

- **`pdf-parse` imported directly into the main process**: Rejected. Violates Constitution XII's intent (untrusted-input parser running in the same address space as the egress hook). OOM crashes the daemon — unacceptable.
- **`pdf2json`**: Considered. Pure JS, similar surface to pdf-parse. Maintenance slightly less active; output format is JSON-AST not raw text (requires a downstream flattening step). Rejected for the extra normalization layer.
- **`pdftotext` (Poppler CLI)**: Rejected. Requires system poppler-utils install; spec Assumptions commit to "no install surface beyond `npm install` for SP-003." Pure-JS option preserves zero-system-dep deployability.
- **`@unpdf/pdfjs`**: Considered. Newer, smaller. Less battle-tested at scale. pdf-parse is the safer 2026 choice.
- **`mupdf-js`**: Rejected. WebAssembly-based; larger memory baseline; immature compared to pdf-parse for v1.

**Implementation guidance**: The shim is a single-file `extract.mjs` (ESM) that does `import pdfParse from 'pdf-parse'`, reads `--in` via `fs.readFile`, calls `pdfParse(buffer)`, writes `result.text` to `--out` via atomic `fs.writeFile` + rename. Errors exit non-zero with the error message on stderr (which `runTool` captures and surfaces as `ToolInvocationError.stderr`). The shim's `package.json` is a standalone npm package with `"type": "module"` and `"private": true`; it does NOT participate in the workspaces graph.

---

## Decision G — HTML→Markdown converter

**Decision**: Use `turndown ^7.2.0` in-process (no subprocess) with a frozen rule set: default rules ONLY, no plugins, no custom rules. The normalizer wraps turndown in `packages/extract/src/normalize-html.ts` and pins the rule configuration. Output determinism is golden-tested in `tests/unit/normalizer-html.test.ts` against a fixture HTML corpus.

**Rationale**:

- **HTML→Markdown is deterministic and CPU-only**: Unlike PDF parsing, HTML conversion has no untrusted-binary-format risk. The input is text bytes; the output is text bytes. No native addon. No memory pathologies. Subprocess isolation is not justified.
- **turndown is the de-facto choice**: Used by show-down, web-clipper-extensions, many static-site generators. Maintenance is active. Pure JS, no native addon. Output is canonical Markdown with predictable rule semantics.
- **Frozen rule set + golden tests for determinism**: turndown allows custom rules and plugins. SP-003 disables both — only the default rule set. Any rule-set drift across versions surfaces in `normalizer-html.golden.test.ts` (a fixture HTML → expected Markdown comparison). This is the project's first golden test, codified now to set the pattern for future deterministic-output components.
- **Reflects ADR-007's "or equivalent"**: ADR-007 allows turndown OR equivalent. turndown is the conservative match.

**Alternatives considered**:

- **`html-to-md`**: Considered. Smaller, less battle-tested. Output less predictable on edge cases (tables, nested lists).
- **`marked` (reverse direction with custom renderer)**: Rejected. marked is markdown→HTML; reversing it requires re-inventing a converter.
- **`pandoc` via subprocess**: Rejected. Requires system pandoc install; same "no system-dep beyond npm install" argument as for pdf-parse.
- **Custom converter**: Rejected. Re-implementing HTML→MD is a maintenance trap.

**Implementation guidance**: Pin `turndown ^7.2.0` exactly (no `~` looser). Use `new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })` — explicit defaults so the rule set is documented in source. Do NOT call `service.use(...)` (which loads plugins). Do NOT call `service.addRule(...)` (custom rules). The golden test asserts byte-identical output against the fixture; minor version bumps that change output break CI immediately.

---

## Decision H — Pipeline policy shape (Constitution VI compliance)

**Decision**: Two named `Policy` objects in `packages/pipeline/src/policies.ts`:

```typescript
export const interactivePolicy: Policy = {
  perDocTimeoutMs: 60_000,
  perStageTimeoutMs: 30_000,
  retryOnRetriableError: false,
  progressEmission: 'stderr',  // CLI invocation shows progress
  watcherInitialScan: true,    // CLI drain processes the inbox once + exits
};

export const batchPolicy: Policy = {
  perDocTimeoutMs: 300_000,
  perStageTimeoutMs: 90_000,
  retryOnRetriableError: true,
  retryMaxAttempts: 1,
  progressEmission: 'none',    // Daemon runs silent; observability via telemetry
  watcherInitialScan: true,
  watcherOngoing: true,        // Daemon keeps watching after initial-scan completes
};
```

The drain orchestrator (`packages/pipeline/src/drain-orchestrator.ts`) accepts `(input, policy, signal)` and dispatches behavior off the policy fields. There is ONE drain function; behavior diverges only via policy field reads.

**Rationale**:

- **Constitution VI is the load-bearing principle**: "Interactive (CLI in terminal) and autonomous (daemon-driven) ingestion MUST share the same in-process library code. They differ only via named `Policy` objects." Forking the drain loop into `drainInteractive()` and `drainBatch()` is the constitutional violation this principle exists to prevent. The policy-object pattern is the principle's prescribed shape.
- **Policy fields cover the spec's tunable surface**: Per-doc timeout (spec Assumptions "Per-document ingest budget" — Plan-stage resolution; interactive needs short timeout for responsiveness, batch tolerates longer for large PDFs). Retry on retriable error (interactive surfaces failures immediately for the user; batch retries once before final failure routing). Progress emission (CLI shows the user something; daemon stays silent — Constitution III "Substrate, Not Surface" — observability via telemetry, not stderr). Watcher behavior (CLI drains once and exits; daemon keeps the watcher open).
- **Constitution VII compatibility**: Per-stage timeouts are configurable via the policy; the drain orchestrator uses `AbortController` + `setTimeout(() => controller.abort(), perStageTimeoutMs)` — NOT `Promise.race(setTimeout)` which is forbidden. Timer cleared on success via `clearTimeout`.
- **CLI dispatch**: `corpus drain` invokes the orchestrator with `interactivePolicy`. The SP-003 daemon's startup script invokes the same orchestrator (inside its master AbortController + watcher loop) with `batchPolicy`. The orchestrator code is identical.

**Alternatives considered**:

- **Single shared default + a few opt-in flags**: Rejected. Diffuses the policy shape — caller must remember which flags apply where. Named Policy objects make the contract explicit.
- **Inheritance-style `BatchPolicy extends Policy`**: Rejected. Type-level cleverness for a shape that's just a record. Plain objects are clearer.
- **Function arguments instead of a policy record**: Rejected. The orchestrator's signature would grow unboundedly. Policy record keeps the surface tight.

**Implementation guidance**: Export `Policy` as a `z.infer<typeof PolicySchema>` to keep the field set in one place (Constitution V). The two pre-built policies are `as const` frozen objects re-validated against `PolicySchema` at module-load time (defense against accidental mutation).

---

## Decision I — Canonical body file layout

**Decision**: Body files live under `Paths.docsStore() + '/<id-prefix>/<doc-id>.md'` where `<id-prefix>` is the first 2 hex characters of the 8-character doc ID. Example: `doc-ab12cd34` → `Paths.docsStore() + '/ab/doc-ab12cd34.md'`. The `documents.body_path` SQLite column stores the path RELATIVE to `Paths.docs()` (so existing SP-002 `fetchDocument` reader contract is preserved — it concatenates `Paths.docs() + '/' + row.body_path` to get the absolute path).

**Rationale**:

- **256-way sharding prevents directory bloat**: At 100k documents (well beyond the single-user expected scale), an unsharded directory hits ~100k entries, which slows `ls` / `readdir` / fs metadata operations on some filesystems. 2-hex-char sharding gives at most 256 subdirectories with ~400 files each — well within filesystem comfort zones. Deterministic from the doc ID itself; no separate mapping table.
- **`processed/` filename collision (spec Edge Case)**: Spec FR-INGEST-003 + Edge Case "Filename collision in processed/" commits to deterministic uniquification. Using the doc-id (8 hex chars from full-file SHA-256) as the canonical filename guarantees uniqueness — no two distinct content hashes collide on doc-id within the cryptographic-collision-rate envelope. The `processed/` folder (under `Paths.processed()`) holds the *original* user-dropped filename for forensics; the canonical body store under `Paths.docsStore()` holds the normalized `<doc-id>.md` for retrieval. Two separate file trees, each serving its own purpose.
- **SP-002 reader compatibility**: SP-002's `fetchDocument` reads `documents.body_path` and joins it onto `Paths.docs()`. Storing the body file under `Paths.docs() + '/store/<id-prefix>/<doc-id>.md'` and recording `body_path = 'store/<id-prefix>/<doc-id>.md'` preserves the reader contract verbatim. No SP-002 changes needed.
- **Atomic-rename semantics**: The body file write happens via `withTempDir` under `Paths.cache()` (existing helper), then atomic rename into `Paths.docsStore() + '/<id-prefix>/<doc-id>.md'`. The id-prefix subdirectory is created with `fs.mkdir({recursive: true})` before the rename (idempotent; no race).

**Alternatives considered**:

- **Flat layout (`Paths.docsStore() + '/<doc-id>.md'`)**: Rejected. Directory bloat at scale.
- **3-hex-char sharding (4096 buckets)**: Rejected. Over-sharded for the single-user scale; sparse directories waste inodes.
- **Date-based sharding (`<YYYY-MM-DD>/<doc-id>.md`)**: Rejected. Couples filesystem layout to ingest_timestamp; complicates re-ingestion and dedup.
- **Single content-addressable layer (filename = SHA-256 hex)**: Considered. Cleaner content-addressable shape, but breaks the SP-002 reader contract (which expects doc-id-based paths). Doc-id is already content-derived (first 8 hex of full-file SHA-256 via FR-INGEST-008 + spec id format), so this is equivalent without the SP-002 churn.

**Implementation guidance**: The persister (`packages/pipeline/src/persister.ts`) computes the body path as a single line: `const bodyRel = path.join('store', docId.slice(4, 6), docId + '.md');` then asserts `bodyRel` starts with `'store/'` (defense against path-injection from a malformed doc-id) before committing the row. The id-prefix is `docId.slice(4, 6)` because `doc-ab12cd34` → indices 4-6 give `'ab'` (skipping the `doc-` prefix).

---

## Risks not turning into decisions

These are surfaced in plan.md's Risk Register but did not require a plan-time decision:

- **R1 (watcher race conditions)**: Mitigated by chokidar's `awaitWriteFinish` (Decision E) + stat-and-recheck defense-in-depth. No additional decision.
- **R3 (SQLite WAL contention with SP-002 readers)**: Mitigated by short per-doc transactions; observability via telemetry. No additional decision.
- **R6 (`documents.hash UNIQUE` migration on existing DBs)**: Mitigated by PREREQ-002's tolerant migration path. No additional decision.
- **R7 (telemetry record size budget)**: Mitigated by capping string fields in the SP-003 event schemas (`data-model.md` §"Telemetry event class size budget"). No additional decision.

---

## Resolved spec ambiguities (recap of Plan-stage commitments)

The spec deferred several details to `/speckit-plan`. The decisions above resolve them:

| Spec reference | Plan-stage resolution |
|---|---|
| Edge Case "Watcher misses a file due to fast write" → "decision between watcher-driven and poll-driven detection is a Plan-stage resolution" | Decision E: chokidar with `awaitWriteFinish` (event-driven on Linux/macOS; polling fallback on macOS-without-fsevents) |
| FR-INGEST-006 → "Plan-stage selection — `turndown` or equivalent" | Decision G: `turndown ^7.2.0` with frozen rule set |
| FR-INGEST-006 → PDF extractor "Plan-stage selection — `pdf-parse` or equivalent" | Decision F: `pdf-parse ^1.1.1` via vendored CLI shim through `runTool` |
| FR-INGEST-002 → "the configured maximum (Plan-stage default; user-configurable via `corpus config`)" | Resolved in `data-model.md` §"Validation gate" (default 100 MB; user-configurable in `config.toml` under `[ingest] max_file_size_mb`) |
| Edge Case "Per-document ingest wall-clock budget" → "Plan-stage resolution" | Plan commits to *documented, measured, within budget* — specific p95 finalized at implementation time once classifier wall-clock is empirically measured (Constitution XVI honesty) |
| Edge Case "Filename collision in processed/" → "Plan-stage decision" | Decision I: 256-way id-prefix sharding under `Paths.docsStore()`; doc-id (content-hash-derived) is the canonical filename |
| Edge Case "File modified during hash" → "Plan-stage decision" | Resolved in `data-model.md` §"Hash stability" (single-stream snapshot semantics; size-changes-during-hash route to `failed/` with `error_code='file_unstable'`) |
| FR-INGEST-008 → classifier-owned columns sentinel values "Plan-stage selection" | Resolved: `facet_domain=''`, `tags_json='[]'`, `facet_type='unclassified'`, `source_type='inbox-filesystem'` (documented in `data-model.md` §"Documents row mapping") |

All deferred items resolved. Phase 1 design proceeds against this research baseline.
