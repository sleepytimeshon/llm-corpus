# Phase 0 — Research: Local LLM Classifier

**Feature**: 004-classifier
**Date**: 2026-05-13

This document records the plan-time architectural decisions that gate SP-004. The spec arrived clean from `/speckit-specify` (zero `[NEEDS CLARIFICATION]` markers — every plan-deferred ambiguity is resolved here or in `data-model.md`). The ten decisions below resolve all SP-004 v1 design space; subsequent sprints (SP-005 embedding, SP-006 kill-9 survival, future user-review promotion) inherit these decisions and can override only via constitutional amendment or follow-up ADR.

Format: Decision → Recommendation → Rationale → Alternatives considered → Source citations.

---

## Decision A — Classifier model choice

**Decision**: Primary classifier model is `qwen3.5:9b` (Q4_K_M quantization, ~5.5 GB on-disk, loaded locally on pai-node01). Fallback model is `gemma3:4b` (Q4_K_M, ~3 GB on-disk, also pre-loaded). The model name is config-driven via `[classifier].model` in `config.toml`; default `qwen3.5:9b`. Switching to `gemma3:4b` is a one-line config change, not a code change.

**Rationale**:

- **Pre-loaded on the user's primary machine**: Both models verified present on pai-node01 (`ollama list` shows `qwen3.5:9b` and `gemma3:4b` among others). Zero install-time burden for SP-004.
- **Structured-output capability**: Both models work with Ollama 0.5+'s `format` parameter (JSON Schema grammar-constrained generation). qwen3.5:9b is the larger and more capable model; gemma3:4b is the faster fallback if qwen3.5:9b proves too slow on CPU for batch-comfort.
- **Structural classification scope**: SP-004's classification task is constrained — facet_domain (1 of ~5-50 established terms), facet_type (1 of 7 constitutional enum values), tags (3-10 from the established tag set or proposed). The task is well within the capability of 4-9B models; the larger qwen3.5:9b provides quality headroom for proposed-term naming and summary writing.
- **No GPU requirement**: SP-004 runs entirely on CPU per the user's pai-node01 configuration. qwen3.5:9b at Q4_K_M is feasible on CPU at ~30-60s per document for the SP-004 prompt budget (vocabulary block + rules + 2000-codepoint body excerpt).
- **Local-only by construction (Principle I)**: Both models are local to Ollama at `http://localhost:11434`; no cloud-API option is ever considered in SP-004 code paths.

**Alternatives considered**:

- **`llama3.1:8b` or `mistral:7b`**: Both viable, both have structured-output support via Ollama. Not pre-loaded on pai-node01; switching would require model downloads. Reject for v1 — qwen3.5:9b is the conservative match to existing state.
- **`qwen3:8b` (also pre-loaded)**: Older qwen generation; structured-output support less battle-tested. Reject as primary; could be a secondary fallback if qwen3.5:9b is uninstalled in the future.
- **GPT-OSS larger models (`qwen3:32b`, `mixtral`)**: Too large for the user's CPU-only pai-node01 hardware budget. Reject.
- **Cloud API (OpenAI, Anthropic, etc.)**: FORBIDDEN by Principle I. Not a real alternative.

**Source citations**:
- Constitution Principle I (Local-First, No Egress)
- Constitution Principle IV (Knowledge, Not Memory; Single-User, Single-Machine)
- FR-012 acceptance scenario "classifier emits schema-valid metadata via grammar-constrained generation"
- Pre-flight verification: `ollama list` on pai-node01 (2026-05-13) confirmed qwen3.5:9b + gemma3:4b loaded
- ADR `contracts/adr-classifier-model-choice.md` (formalized in this sprint)

---

## Decision B — Inference transport

**Decision**: HTTP POST to `http://localhost:11434/api/chat` (Ollama 0.5+ structured-outputs endpoint) via the existing `undici` HTTP client (SP-001 transport-layer dependency). The request body uses Ollama's chat-completion shape with the `format` field set to the rendered JSON Schema from `ClassifierOutputZodSchema`. `stream: false` (we want the full response in one body), `options.temperature: 0.1` (low for determinism — classification is not a creative task).

**Rationale**:

- **Ollama 0.5+ supports `format` as JSON Schema**: Verified against `https://ollama.com/blog/structured-outputs` (2024-12-06). The `format` parameter accepts either the string `'json'` (any valid JSON) or a JSON Schema object (token-grammar constrained to the schema). SP-004 uses the latter.
- **AbortSignal-native through `undici`**: undici's `fetch` API takes a standard `signal: AbortSignal` option; SIGTERM propagation works end-to-end without `Promise.race(setTimeout)` (Principle VII). `undici` is already in the SP-001 transport dependency graph.
- **Localhost-allowlisted by construction (Principle I)**: The SP-001 egress hook permits localhost destinations by default; `http://localhost:11434` is permitted by construction. Any accidental non-localhost classifier endpoint (e.g., a future bug introducing a cloud fallback) hard-fails with `EgressBlockedError`.
- **`/api/chat` vs `/api/generate`**: SP-004 uses `/api/chat` because the structured-outputs documentation focuses on the chat endpoint and the system-message + user-message split is cleaner for the classification contract (system message names the contract; user message carries vocab block + rules + document context).
- **`stream: false` justification**: SP-004 needs the full response for Zod-parse before any persistence; streaming has no benefit for a one-shot classification call. The chunked-response complexity isn't worth the negligible time-to-first-byte improvement for a single document.

**Alternatives considered**:

- **Native Ollama Node SDK (`@ollama/ollama`)**: Possible. Wraps the same HTTP API. Rejected for: (a) adds a dependency for what `undici` already does cleanly, (b) the SDK's abstraction surface may not give clean AbortSignal propagation (depending on version), (c) the SP-001 egress hook is at the HTTP-call boundary; using a higher-level SDK adds a layer the egress hook still has to penetrate.
- **`fetch` from Node's global**: Node 20+ has a global `fetch`. Functionally equivalent. Rejected for project consistency — SP-001 uses `undici` explicitly; SP-004 stays on `undici`.
- **gRPC-style Ollama transport**: Doesn't exist. Reject.
- **Streaming response with chunked parsing**: Premature complexity. Reject for SP-004; revisit in SP-005 if classifier latency becomes the bottleneck and time-to-first-byte matters.

**Source citations**:
- Constitution Principle I (Local-First, No Egress)
- Constitution Principle VII (Cancellable, Bounded IO)
- Ollama structured-outputs blog (2024-12-06)
- SP-001 transport dependency (`undici` in `packages/transport/`)

---

## Decision C — Prompt template architecture

**Decision**: The classifier prompt is a two-message conversation: (1) a system message naming the structured-output contract and providing the classification rules ("Output JSON matching this schema; populate facet_domain from established list OR propose a new one via facet_domain_proposed; populate tags from established list OR propose via facet_tags_proposed; etc."), (2) a single user message containing three labeled blocks — `## Established vocabulary`, `## Document`, and an implicit closing. The user message is rendered at call time from the EstablishedVocabulary snapshot + the document's title, source_path, mime_type, and the first 2000 codepoints of body.

**Template skeleton** (rendered):

```
SYSTEM:
You are a corpus classification assistant. Read the document and emit JSON matching the provided schema. Rules:
- facet_domain MUST be one of the established domains listed below, OR you may propose a new one via the optional facet_domain_proposed field (and choose the closest-fitting established value for facet_domain).
- tags MUST be 3-10 entries from the established tags listed below, OR propose new tags via facet_tags_proposed (and include established tags in tags for established ones).
- facet_type MUST be one of: entity, concept, tutorial, analysis, reference, synthesis, cheat-sheet.
- summary MUST be 15-25 words capturing the document's core insight.
- confidence sub-scores ∈ [0, 1] indicate your certainty on each axis.

USER:
## Established vocabulary

Domains: <comma-separated list from EstablishedVocabulary.domains>
Tags: <comma-separated list from EstablishedVocabulary.tags>

## Document

Title: <documents.title>
Source: <documents.source_path>
MIME: <documents.mime_type>

<first 2000 codepoints of body, UTF-8-safe boundary>
```

**Rationale**:

- **System / user split mirrors Ollama's chat format**: The Ollama `/api/chat` endpoint expects an array of messages with `role` values. The system / user split is the natural shape; the system message is stable across documents (only the rules change at version bumps), and the user message is per-document (vocab block + doc context).
- **Vocabulary block placement**: The vocabulary is in the user message (not the system) because it's loaded fresh per-batch — putting it in the system message would suggest it's stable across the conversation, which is misleading. Per-batch refresh (Decision E) is the constitutional shape.
- **Body excerpt cap of 2000 codepoints**: A 2000-codepoint excerpt covers the title, abstract, and opening paragraphs of most documents — sufficient to determine domain/type/tags without overwhelming the prompt budget. qwen3.5:9b's context window (32K tokens) easily fits this; the cap exists to bound per-document classification latency and to keep the prompt-token-estimate field meaningful in telemetry. Documented in FR-CLASSIFY-020.
- **UTF-8-safe truncation (FR-CLASSIFY-020)**: JavaScript string `slice(0, 2000)` operates on UTF-16 code units, which is safe for the Basic Multilingual Plane and benign for codepoint pairs at the boundary (a paired surrogate at indices 1999-2000 is truncated cleanly, dropping the second surrogate; the resulting string is well-formed UTF-16). For documents with significant non-BMP content (rare for the user's corpus), a future ADR can switch to grapheme-cluster-aware truncation.
- **No few-shot examples**: SP-004 doesn't include example classifications in the prompt. The structured-output `format` parameter handles the schema contract; the rules block in the system message names the vocabulary contract. Few-shot prompts would lengthen the user message and reduce headroom for the document body excerpt. Future quality work may revisit.

**Alternatives considered**:

- **Single-message user-only prompt**: Combining system + user into one user message works for some models but loses the convention. Reject for consistency with Ollama's chat API design.
- **Multi-turn assistant priming**: Pre-priming with example classifications via fake assistant turns. Reject as premature complexity; revisit if classification quality is insufficient at SP-005 benchmark time.
- **Larger body excerpt (5000+ chars)**: Doesn't materially improve classification quality for the SP-004 scope (domain/type/tags from 7-value enum), increases latency. Reject.
- **System message containing the vocabulary**: Misleading semantically (vocabulary is per-batch, not stable). Reject.

**Source citations**:
- Constitution Principle V (Schema-Enforced Structured Output)
- Constitution Principle XV (Dynamic Taxonomy with User-Reviewed Promotion)
- FR-014 (vocabulary validation across input cases)
- SCHEMA.md `facet_type` enum (7-value)

---

## Decision D — Retry policy

**Decision**: On Zod schema validation failure (FR-CLASSIFY-005), the classifier retries ONCE (one additional Ollama HTTP call) with the same prompt + schema. If the second attempt also fails validation, the row routes to the failure lane with `<doc-id>.error.json` sidecar carrying `error_code='schema_invalid', retriable=true, retry_count=1`. On Ollama HTTP failure (ECONNREFUSED, ENETUNREACH), NO retry happens — the row routes immediately to the failure lane with `error_code='ollama_unavailable', retriable=true`. On vocabulary violation (FR-CLASSIFY-006 defense-in-depth), NO retry — vocabulary is stable for the batch, so retrying with the same prompt yields the same response. The retry-once policy applies ONLY to schema-validation failures.

**Rationale**:

- **One retry catches transient sampler degeneracy**: Ollama's token-grammar-constrained sampler is deterministic given a fixed seed, but `options.temperature: 0.1` introduces minor randomness. A first-call schema validation failure is most likely a sampler edge case (e.g., truncation hit, EOS token race); a retry with the same prompt usually succeeds. Empirical testing during Phase 5 implementation will measure first-call vs retry success rates.
- **More retries waste latency without changing outcome**: If two consecutive retries fail with the same prompt, the prompt itself is the problem (e.g., the document body excerpt is degenerate — empty body, all-whitespace body, body in an unsupported character set). A third retry won't fix that. The failure-lane sidecar with `retriable=true` lets a future `corpus drain --retry-failed` (SP-006) re-attempt with a fresh vocabulary snapshot or after a model swap.
- **Ollama-unavailable is a network/process state, not a sampler state**: An ECONNREFUSED indicates Ollama isn't running. Retrying within the same classify call doesn't fix that — the user (or systemd) needs to restart Ollama. The failure-lane route lets the next reenrich after restart re-attempt naturally.
- **Vocabulary violation is structurally deterministic**: The classifier proposed a value that's neither in the established vocab nor in the proposed-fields. Retrying yields the same vocabulary mismatch (same snapshot, same prompt). Vocabulary changes only via user-review promotion (Principle XV); a future `corpus drain --retry-failed` after promotion will succeed.

**Alternatives considered**:

- **Exponential backoff with N retries**: Adds latency for transient cases without lifting the structural-failure ceiling. Reject for SP-004 — the failure-lane sidecar is the durable recovery mechanism.
- **Zero retries**: Loses the cheap-win for transient sampler degeneracy. Reject; one retry is the right balance.
- **Retry with a different model**: Possible. Reject for SP-004 — adds complexity (which model to fall back to, how to record the fallback in telemetry) without strong evidence of need. Defer to a future ADR if needed.
- **Retry with a different prompt** (e.g., shorter excerpt): Adds prompt-template branching. Reject for SP-004.

**Source citations**:
- FR-013 (defense-in-depth schema validation)
- FR-012 acceptance scenario "classifier produces schema-valid output on first generation attempt with retry_count=0"
- Constitution Principle XVI (Validation Honesty)

---

## Decision E — Vocabulary refresh cadence

**Decision**: `EstablishedVocabulary` is loaded once per classify-stage invocation (daemon hook OR `corpus reenrich` batch) and is stable for the lifetime of that invocation. Subsequent classifies within the same invocation reuse the snapshot. The snapshot has a `snapshot_id` (UUID v4 generated at load time) that appears in `classify.started` telemetry for observability.

**Rationale**:

- **Per-document refresh is wasteful**: A `corpus reenrich` batch of 500 documents would issue 500 SELECTs against `taxonomy_terms` — unnecessary, since the vocabulary changes only via user-review promotion (Principle XV), and promotion is not part of the classify-stage code path.
- **Per-batch snapshot is constitutional**: Principle XV mandates that vocabulary changes go through user-review. The snapshot's staleness within a batch (proposed terms inserted mid-batch by the same drain-lock-holder are not visible to the rest of the batch) is correct, not a bug — promotion is the only way established vocabulary grows.
- **Snapshot stability simplifies defense-in-depth**: The FR-CLASSIFY-006 cross-check uses the same snapshot the prompt was rendered with. If vocabulary were refreshed per-document, a race window opens (vocab grows between prompt render and post-Ollama validate).
- **Snapshot ID for observability**: A UUID per snapshot lets telemetry reviewers correlate which set of documents was classified against which vocabulary state. Useful for future quality analysis.

**Alternatives considered**:

- **Per-document refresh**: Wasted SQL queries. Reject.
- **Persistent in-memory cache across invocations**: SP-004 invocations are short-lived (a daemon hook completes per document; a reenrich batch completes in one process lifetime). Caching across invocations is moot. Reject.
- **Snapshot on a timer (e.g., every 5 minutes)**: Decouples cadence from invocation lifetime. Adds complexity without benefit at the single-user / single-machine scale. Reject.

**Source citations**:
- Constitution Principle XV (Dynamic Taxonomy with User-Reviewed Promotion)
- FR-014 (vocabulary validation across input cases)
- Constitution Principle IX (Concurrency-Safe Shared State — single drain-lock holder per invocation)

---

## Decision F — Atomicity strategy: paired SQL transaction + body-file frontmatter rewrite

**Decision**: The classify-persister commits the SQL UPDATE + 0..N taxonomy_terms INSERTs + the atomic rename of the tmp body-file in a single SQLite transaction. Step-by-step:

1. Generate the rewritten body-file content via `stringifyMarkdownWithFrontmatter({frontmatter: <classifier output>, body: <preserved>})`.
2. Write the content to a tmp path under `Paths.cache()` via `withTempDir` (atomic per Principle VIII; PID+entropy temp suffix).
3. `BEGIN TRANSACTION` on the better-sqlite3 connection.
4. Execute `UPDATE documents SET facet_domain=?, tags_json=?, facet_type=? WHERE id=? AND facet_type='unclassified'`. Assert the row count is 1 (defense-in-depth idempotency — see FR-CLASSIFY-012).
5. For each proposed term in `facet_domain_proposed` / `facet_tags_proposed`: `INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES (?, ?, 'proposed', NULL) ON CONFLICT(axis, term) DO NOTHING`. Conflicts are not errors (idempotent).
6. Atomic-rename the tmp body file to the canonical path `Paths.docs() + '/' + row.body_path` via `fs.rename` (atomic on POSIX).
7. `COMMIT`.
8. On any failure between step 3 and step 7: `ROLLBACK`, delete the tmp body file, write the `<doc-id>.error.json` sidecar with the matching `error_code`.

**Rationale**:

- **Single transaction satisfies Constitution VIII**: The SQL UPDATE + taxonomy_terms INSERTs are wrapped in a `BEGIN/COMMIT`. The atomic rename is the LAST step before COMMIT — if the rename succeeds and the COMMIT succeeds, both sides are durable; if either fails, the rollback undoes the SQL side and the tmp file is deleted.
- **Why the rename happens before COMMIT (not after)**: If the rename succeeds AFTER COMMIT, a process crash between COMMIT and rename leaves the SQL row classified but the body file at the old (SP-003-sentinel-frontmatter) state — an SQL ↔ frontmatter divergence violating SC-CLASSIFY-005. The rename-before-COMMIT pattern means the SQL transaction's success implies the body file is at the new state. A process crash AFTER rename but BEFORE COMMIT leaves the body file at the new state but the SQL row sentinel — re-running classify-stage observes the sentinel row, reclassifies (same input → same output if vocab is stable; or different output if vocab evolved), rewrites the body file (overwrite, no information loss), and re-commits. Idempotent.
- **`withTempDir` is the canonical primitive (Principle VIII)**: The SP-001 / SP-002 / SP-003 codebase has the helper. SP-004 reuses unchanged.
- **Defense-in-depth idempotency (`AND facet_type='unclassified'`)**: Even with the drain-lock, a race-window-free design is preferable. The clause means a concurrent classify (e.g., if the drain-lock were ever bypassed) results in a 0-row UPDATE, transaction rollback, no body-file overwrite, no telemetry false-success.
- **Why not write the body file BEFORE the transaction**: That would risk an SQL ↔ frontmatter divergence on SQL failure. The transaction is the atomic unit.

**Alternatives considered**:

- **Two-phase commit (write body file separately, then update SQL)**: Doesn't give atomic semantics — a process crash between the two phases leaves divergent state. Reject.
- **Write SQL first, body file after**: Same divergence risk. Reject.
- **Use SQLite's `STORED` blob for body content**: Would put the body in SQLite, eliminating the body-file rewrite entirely. Reject — SP-003 / SP-002 ship the on-disk body-file layout, and a future ADR would be needed to migrate. SP-004 stays compatible.
- **Eventual-consistency reconciliation**: Periodic scan that detects SQL ↔ frontmatter divergence and reconciles. Reject — masks bugs rather than preventing them.

**Source citations**:
- Constitution Principle VIII (Atomic Writes & Transactional Index Updates)
- FR-013 (Classifier output is schema-validated before frontmatter writeback)
- SP-003 Decision I (body file layout)
- ADR `contracts/adr-classifier-atomicity.md` (formalized in this sprint)

---

## Decision G — Drain-lock reuse vs separate classify-lock

**Decision**: SP-004 REUSES SP-003's `Paths.drainLock()` as the single serialization point across SP-003 ingest, SP-004 classify, and (future) SP-006 retry. No separate classify-lock. The daemon's post-persist hook reuses the already-held lock (the daemon acquired it at drain start). The `corpus reenrich` CLI command acquires the lock independently; if contention, emits `pipeline.lock_contention` and exits 0 (FR-INGEST-011 contract preserved).

**Rationale**:

- **Single serialization point simplifies invariants**: With one lock, the invariant is "at most one writer holds the lock; that writer owns all SQL UPDATE / INSERT / DELETE activity AND all body-file rewrites AND all sidecar writes." Two locks would multiply the deadlock surface (lock ordering, lock-pairing rules) and complicate testing.
- **No realistic concurrency benefit from separate locks**: A scenario where SP-003 ingest and SP-004 classify could profitably run in parallel would require independent state segregation — but they touch the same SQLite file (same WAL writer lock) and the same body-file directory tree. Parallelism would just shift the contention to the SQLite writer lock, with worse observability.
- **SP-003's flock contract is already proven**: SP-003's FR-INGEST-011 + SC-INGEST-015 demonstrate the flock semantics work end-to-end. Reusing the same primitive inherits all the proof.

**Alternatives considered**:

- **Separate classify-lock at `Paths.classifyLock()` (new path)**: Doubles the serialization surface, requires careful lock-ordering rules to avoid deadlock, adds a new `Paths.*` getter. Reject for SP-004 — no concurrency benefit at the single-user / single-machine scale.
- **Lock-free with optimistic concurrency (CAS on `documents.facet_type`)**: The `AND facet_type='unclassified'` UPDATE clause provides this property. Reject as the primary mechanism — the drain-lock is still needed for body-file rewrite atomicity (`withTempDir` rename target uniqueness).
- **Read-write lock (multiple readers, one writer)**: Overkill for the single-user scale; the SP-002 readers already operate without lock contention (SQLite WAL allows concurrent readers).

**Source citations**:
- Constitution Principle IX (Concurrency-Safe Shared State)
- SP-003 FR-INGEST-011 (drain-lock contract)
- SP-003 SC-INGEST-015 (drain-lock serialization invariant)

---

## Decision H — Body excerpt truncation

**Decision**: The prompt template includes the first 2000 codepoints (NOT bytes) of the normalized Markdown body. Implementation: `bodyText.slice(0, 2000)` where `bodyText` is the body section read from the body file via `fs.readFile(body_path, 'utf-8')`. JavaScript string `slice` operates on UTF-16 code units; for BMP-only content (the vast majority of the user's corpus), this is equivalent to codepoint slicing. For non-BMP content (rare), the slice may truncate a surrogate pair, but the result is still well-formed UTF-16 (the orphan high surrogate is dropped silently by the V8 string encoder when serialized to JSON, producing a valid UTF-8 byte stream for the Ollama POST).

**Rationale**:

- **2000 codepoints is sufficient for SP-004's classification scope**: The classification task (domain / type / tags / 15-25-word summary) needs the document's opening (title, abstract, first few paragraphs). 2000 codepoints typically covers ~300-400 words, enough for first-page-of-paper or first-section-of-article context.
- **JavaScript's string semantics keep the code simple**: `slice` is the idiomatic primitive. Grapheme-cluster-aware truncation (via `Intl.Segmenter`) would be more correct for non-BMP content but adds complexity for negligible benefit at the user's corpus scale.
- **The prompt-token-estimate field in telemetry is meaningful**: A hard cap at 2000 codepoints means the prompt's total token count is bounded (vocabulary block + rules + 2000 codepoints ≈ 5000-8000 tokens for typical docs), so per-document latency variance is bounded.

**Alternatives considered**:

- **Byte-count cap (2000 bytes)**: Conservative for ASCII-heavy content; aggressive for multibyte UTF-8. A document with significant non-Latin content would get under 2000 codepoints. Reject — codepoint cap is more uniform.
- **Token-count cap (e.g., 1024 tokens)**: Requires the classifier-side tokenizer to be available in TypeScript code. Adds dependency. Reject for SP-004; revisit if telemetry shows wide latency variance.
- **No cap (full body)**: Unbounded prompt length → unbounded latency → potential 30K+ token contexts that don't fit qwen3.5:9b's 32K window. Reject.
- **Grapheme-cluster-aware truncation via `Intl.Segmenter`**: More correct for non-BMP content but adds complexity. Reject for SP-004; future ADR if user's corpus shifts to heavy non-BMP content.

**Source citations**:
- Constitution Principle V (Schema-Enforced Structured Output) — bounded input handling
- FR-CLASSIFY-020 (Body excerpt truncation at UTF-8-safe codepoint boundary)
- ARCHITECTURE-FINAL §11.5 (bounded execution discipline)

---

## Decision I — Proposed term ON CONFLICT handling

**Decision**: SP-004's proposed-term INSERTs use `INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES (?, ?, 'proposed', NULL) ON CONFLICT(axis, term) DO NOTHING`. Duplicate proposals (same axis, same term) collapse to a single row. SP-004 NEVER INSERTs `state='established'` — the SQL string in `packages/storage/src/taxonomy-terms-adapter.ts` (PREREQ-005) hardcodes the state literal, making established-state writes structurally impossible from the SP-004 code path.

**Rationale**:

- **Principle XV: N≥3 in 30 days is a GATE not an auto-trigger**: SP-004 must not auto-promote proposed → established under any circumstance. The promotion workflow lives in a future user-review sprint. SP-004's role is to RECORD proposals; the user reviews them later.
- **ON CONFLICT DO NOTHING collapses duplicates without error**: Multiple documents may propose the same novel domain (e.g., five documents all propose `quantum-cryptography` because they're all about that subject). The first INSERT lands the row; the subsequent INSERTs are conflict-no-ops. The future user-review surface sees one row per unique proposal, with a count derivable from `classify.term_proposed` telemetry events.
- **Telemetry per insert-or-conflict**: Both fresh INSERTs and conflict-no-ops emit `classify.term_proposed` events. The future user-review surface can rank proposals by occurrence count from telemetry.
- **Hardcoded state literal in SQL**: Defense-in-depth. The adapter function signature is `insertProposedTerm(axis, term, signal)` — there's no state parameter. The SQL template literal contains `'proposed'`. A future bug attempting to insert `'established'` would require an explicit code change.

**Alternatives considered**:

- **Upsert with count tracking** (`ON CONFLICT DO UPDATE SET count = count + 1`): Would require adding a `count` column to `taxonomy_terms`. Reject — schema change without payoff (telemetry events provide the count signal).
- **`INSERT OR IGNORE`**: SQLite synonym for ON CONFLICT DO NOTHING for primary-key conflicts. Functionally equivalent; the explicit `ON CONFLICT(axis, term) DO NOTHING` is more readable and doesn't depend on the PRIMARY KEY definition.
- **Two-phase: SELECT then INSERT if not exists**: Race-prone (a concurrent classify could INSERT between SELECT and INSERT). Reject — the atomic ON CONFLICT semantic is the right primitive.

**Source citations**:
- Constitution Principle XV (Dynamic Taxonomy with User-Reviewed Promotion)
- FR-014 (vocabulary validation across input cases)
- SP-003 `data-model.md` `taxonomy_terms` schema (existing column shape, unchanged)
- PREREQ-005 (`taxonomy-terms-adapter.ts` write-side adapter)

---

## Decision J — Schema-emitter library choice

**Decision**: Use `zod-to-json-schema ^3.x` as the canonical Zod → JSON Schema emitter. The conversion happens once at module-load time inside `packages/contracts/src/classifier-schema.ts`: `export const CLASSIFIER_OUTPUT_JSON_SCHEMA = zodToJsonSchema(ClassifierOutputZodSchema)`. The rendered schema is post-processed to strip top-level `$schema` keyword (Ollama doesn't need it) and to inline any `$ref` references (Ollama's structured-output parser may not resolve them).

**Rationale**:

- **Single source of truth for the schema**: The Zod schema in TypeScript is the authoritative shape. The JSON Schema rendering is mechanical. Having a separately-maintained JSON Schema would drift; mechanical rendering keeps them locked.
- **Pure JS, zero native addons**: `zod-to-json-schema` is pure TypeScript with no native dependencies. No allowlist impact.
- **Mature and maintained**: Used by many Zod-adopting projects. Version 3.x is stable.
- **Ollama JSON Schema compatibility quirks (R3 in plan.md)**: Ollama's `format` parameter accepts JSON Schema with some restrictions (no `$schema`, prefers inline definitions over `$ref`). The post-processing step is small (~20 lines) and is covered by a unit test that asserts the rendered schema parses through a JSON Schema validator.

**Alternatives considered**:

- **Hand-maintain the JSON Schema separately**: Drift risk. Reject.
- **Use Ollama's own schema renderer (if exists)**: Doesn't exist. Reject.
- **`@anatine/zod-openapi`**: Renders Zod → OpenAPI schema (a superset of JSON Schema). Heavier than needed for SP-004. Reject.
- **Write a custom Zod → JSON Schema renderer**: Re-inventing a maintenance trap. Reject.

**Source citations**:
- Constitution Principle V (Schema-Enforced Structured Output)
- FR-012 (Local-LLM classifier emits schema-valid metadata via grammar-constrained generation)
- Ollama structured-outputs blog (2024-12-06) — JSON Schema requirements

---

## Risks not turning into decisions

These are surfaced in plan.md's Risk Register but did not require a plan-time decision:

- **R1 (Ollama version skew on `format` parameter)**: Mitigated by recording Ollama version at OllamaAdapter boot + quickstart documentation. No additional decision.
- **R2 (`qwen3.5:9b` wall-clock on CPU)**: Mitigated by Decision A's fallback to `gemma3:4b`. No additional decision.
- **R4 (Vocabulary snapshot staleness during long batch)**: Mitigated by Decision E's per-batch refresh semantic. Correct by design.
- **R5 (Confidence threshold drift across retries)**: Confidence lives in telemetry; future low-confidence-review surface can act on it. No SP-004 decision.
- **R7 (Telemetry record size budget)**: Mitigated by capping string fields in SP-004 event schemas (`data-model.md` §"Telemetry event class size budget"). No additional decision.
- **R8 (Single-threaded classify-stage may bottleneck reenrich at scale)**: Acceptable for v1 (single-user / single-machine); documented. Defer parallelism to SP-005 if benchmarks demand.

---

## Resolved spec ambiguities (recap of Plan-stage commitments)

The spec deferred several details to `/speckit-plan` (or pre-resolved them in the design-decisions block of the dispatch prompt). The decisions above resolve them:

| Spec / dispatch reference | Plan-stage resolution |
|---|---|
| Primary classifier model | Decision A: `qwen3.5:9b` primary; `gemma3:4b` fallback |
| Inference transport | Decision B: HTTP POST to `http://localhost:11434/api/chat` via `undici` |
| Prompt template architecture | Decision C: system + single user-turn block with vocabulary + rules + document context |
| Retry policy | Decision D: 1 retry on schema-invalid; no retry on Ollama-unavailable / vocabulary-violation |
| Per-document timeout | Plan: 60 s interactive / 300 s batch (FR-CLASSIFY-009; codified in PREREQ-004 policy fields) |
| Concurrency | Plan FR-CLASSIFY-019: single-doc-at-a-time within a single drain call |
| Atomicity | Decision F: paired SQL transaction + body-file rewrite with `withTempDir` |
| Trigger surface | Plan: daemon post-persist hook + `corpus reenrich` CLI |
| Vocabulary loading cadence | Decision E: per-batch snapshot |
| Proposed term routing | Decision I: ON CONFLICT DO NOTHING; never auto-promote |
| Body frontmatter sync | Plan: SP-004 rewrites the YAML frontmatter to mirror SQL; confidence never persisted (FR-CLASSIFY-013) |
| Body excerpt boundary | Decision H: 2000 codepoints via JS string slice |
| Drain-lock reuse | Decision G: REUSE SP-003's `Paths.drainLock()` |
| JSON Schema emitter | Decision J: `zod-to-json-schema ^3.x` |

All deferred items resolved. Phase 1 design proceeds against this research baseline.
