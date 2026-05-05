# llm-corpus — Architecture

**Companion to:** `WHITEPAPER-FINAL.md`
**Audience:** distinguished engineers, architects, developers building or evaluating the system

This document is the technical specification of llm-corpus. The whitepaper describes the idea; this document describes what is built. An implementing engineer can build the system from this specification without ambiguity; an architect can evaluate it without writing code; a code reviewer can identify violations of the contracts it establishes.

---

## 1. System Overview

```
                ┌─────────────────────────────────────────────────────────┐
                │                CONSUMERS (any AI agent)                 │
                │   Claude Code · Gemini CLI · Codex CLI · local LLMs     │
                └─────────────────────────────┬───────────────────────────┘
                                              │
                ┌─────────────────────────────▼───────────────────────────┐
                │                    INTERFACES                           │
                │                                                         │
                │   `corpus` CLI binary           MCP server (read-only)  │
                │   ────────────────────         ────────────────────     │
                │   ingest, remove, restore,      tool: corpus.find       │
                │   purge, init, doctor,          resources: manifest,    │
                │   reindex, reenrich,            taxonomy, docs/{id},    │
                │   daemon, telemetry             docs/{id}/images/{n},   │
                │   (and corpus mcp)              list, recent, trash     │
                │                                 prompts: consult,       │
                │                                 cite, summarize         │
                └─────────────────────────────┬───────────────────────────┘
                                              │
                ┌─────────────────────────────▼───────────────────────────┐
                │                       CORE                              │
                │                                                         │
                │   pipeline · classification · retrieval · schema ·      │
                │   reconciler · janitor · telemetry · policies           │
                └──────────┬──────────────────────────────────┬───────────┘
                           │                                  │
        ┌──────────────────▼──────────────────┐  ┌────────────▼──────────┐
        │           ADAPTER PLANE              │  │   STORE (XDG roots)   │
        │                                      │  │                       │
        │   StorageAdapter   FsMarkdownStorage │  │   $XDG_DATA_HOME/     │
        │   InferenceAdapter OllamaAdapter     │  │     llm-corpus/       │
        │   EmbeddingAdapter OllamaEmbeddings  │  │       docs/           │
        │   IndexAdapter     SqliteIndex       │  │       inbox/          │
        │   ExtractorAdapter UrlExtractor      │  │       assets/         │
        │                    PdfExtractor      │  │   $XDG_STATE_HOME/    │
        │                    EpubExtractor     │  │     llm-corpus/       │
        │                    AudioExtractor    │  │       index.db        │
        │                    …                 │  │       telemetry.jsonl │
        └──────────────────────────────────────┘  └───────────────────────┘
```

Four layers: consumer-facing interfaces, an in-process core library, an adapter plane abstracting every external dependency, and an XDG-rooted local store. Dependencies flow downward only; an interface calls into the core, the core calls into adapters, adapters speak to the store and to external processes (Ollama, system tools). No layer reaches across.

---

## 2. The Installation Contract

The system is a userspace tool. It installs under XDG Base Directory paths. It requires no root privilege at any point, writes nothing outside the user's home directory, and creates no system service units the user did not ask for.

### 2.1 Path Resolution

```ts
// packages/core/src/paths.ts — the single resolver, used everywhere

import { homedir } from 'node:os';
import { join } from 'node:path';

const xdg = (varName: string, fallback: string) =>
  process.env[varName] ?? join(homedir(), fallback);

export const Paths = Object.freeze({
  // roots
  data:   () => process.env.CORPUS_HOME ??
                join(xdg('XDG_DATA_HOME',   '.local/share'),  'llm-corpus'),
  state:  () => join(xdg('XDG_STATE_HOME',  '.local/state'), 'llm-corpus'),
  config: () => join(xdg('XDG_CONFIG_HOME', '.config'),      'llm-corpus'),
  cache:  () => join(xdg('XDG_CACHE_HOME',  '.cache'),       'llm-corpus'),
  // derived data
  docs:        () => join(Paths.data(),  'docs'),
  inbox:       () => join(Paths.data(),  'inbox'),
  pending:     () => join(Paths.inbox(), 'pending'),
  processed:   () => join(Paths.inbox(), 'processed'),
  failed:      () => join(Paths.inbox(), 'failed'),
  trash:       () => join(Paths.data(),  'trash'),
  assets:      () => join(Paths.data(),  'assets'),
  taxonomy:    () => join(Paths.data(),  'taxonomy.yml'),
  catalog:     () => join(Paths.data(),  'CATALOG.md'),
  // derived state
  indexDb:     () => join(Paths.state(), 'index.db'),
  telemetry:   () => join(Paths.state(), 'telemetry.jsonl'),
  sourceIndex: () => join(Paths.state(), 'source-index.jsonl'),
  drainLock:   () => join(Paths.state(), 'drain.lock'),
  // config + cache
  configFile:  () => join(Paths.config(), 'config.toml'),
  extractCache:() => join(Paths.cache(),  'extracts'),
});
```

`CORPUS_HOME` is the single override the user may set to relocate the data root (e.g. to a separate disk). All other paths derive from XDG variables.

A lint rule rejects any source file that uses string literals matching `/^/data/` or hard-coded `llm-corpus` paths outside `Paths`. There is exactly one place in the source tree that knows where things live.

### 2.2 Initialization

```
$ corpus init
Creating XDG layout under ~/.local/share/llm-corpus ...                       OK
Creating state under ~/.local/state/llm-corpus ...                            OK
Creating config under ~/.config/llm-corpus/config.toml ...                    OK
Creating cache under ~/.cache/llm-corpus ...                                  OK
Probing Ollama at http://localhost:11434 ...                                  OK
Pulling default classifier model (qwen3:8b) [5.2 GB] ...               (skipped — already present)
Pulling default embedding model (nomic-embed-text) [274 MB] ...               OK
Compiling SQLite extensions (FTS5 + sqlite-vec) ...                           OK
Building empty index ...                                                      OK
Installing daemon (systemd user unit) ...                                     ASK
   Install a watcher for ~/.local/share/llm-corpus/inbox/ ?  [Y/n]  y
   Wrote ~/.config/systemd/user/llm-corpus-watch.service                      OK
Running doctor ...                                                            OK
```

`corpus init --import <path>` adopts an existing Markdown directory (an Obsidian vault, a notes folder, an exported wiki) and treats it as the initial document set. The system imports references and ingests metadata; it does not move the source files. Re-running `init` is idempotent.

---

## 3. Module Boundaries

The implementation is an npm-managed monorepo with the following packages. Each has a defined dependency direction; the build fails if a forbidden import is added.

```
packages/contracts/    types only — Document, Frontmatter, Adapters, Errors
packages/core/         pure functions, zero IO — schema, depth router, RRF, policy
packages/storage/      StorageAdapter implementations — FsMarkdownStorage default
packages/index/        IndexAdapter — SQLite (FTS5 + sqlite-vec), Bun + Node backends
packages/inference/    InferenceAdapter, EmbeddingAdapter — Ollama default
packages/extract/      ExtractorAdapter registry — one impl per source format
packages/pipeline/     state machine — composes adapters, holds policies
packages/transport/    transport layer — cli/, mcp/
packages/daemon/       file watching, lock owner, systemd/launchd integration
packages/cli/          the `corpus` binary entry point
packages/mcp/          the MCP server entry point (also reachable as `corpus mcp`)
```

**Dependency direction:** `contracts → core → (storage, index, inference, extract) → pipeline → transport → cli|mcp|daemon`. Lower layers cannot import upper layers. `core` imports nothing from outside the monorepo except `node:` built-ins and one YAML library.

**The seam test:** delete `packages/inference/`, replace it with a stub returning canned classifications, and run the integration suite. The suite passes. If this is not true, the seam is not real.

---

## 4. The Adapter Plane

### 4.1 StorageAdapter

```ts
interface StorageAdapter {
  getDoc(id: DocId): Promise<Document | null>;
  putDoc(doc: Document, opts: { atomic: true }): Promise<void>;
  deleteDoc(id: DocId, opts: { soft: true; ttlDays?: number }): Promise<void>;
  restoreDoc(id: DocId): Promise<void>;
  listDocs(filter?: DocFilter): AsyncIterable<DocMetadata>;
  withTempFile<T>(fn: (path: string) => Promise<T>): Promise<T>;
}
```

Default: `FsMarkdownStorage` writes files under `Paths.docs()` with an atomic `tmp + fsync + rename + dirsync` sequence. The `.tmp` suffix carries the writer PID and entropy bytes (`.tmp.{pid}.{rand4hex}`) so concurrent writers cannot collide on a temp path. `withTempFile` guarantees cleanup on success, exception, and signal. Soft delete moves the document to `Paths.trash()/{doc-id}/` with a TTL marker; restore lifts it back to `Paths.docs()/`.

### 4.2 InferenceAdapter

```ts
interface InferenceAdapter {
  classify(input: ClassifyInput, signal: AbortSignal): Promise<ClassifyResult>;
  transform(input: TransformInput, signal: AbortSignal): Promise<TransformResult>;
  vision(input: VisionInput, signal: AbortSignal): Promise<VisionResult>;
}
```

All three methods take an `AbortSignal`. The default `OllamaAdapter` uses `fetch('http://localhost:11434/api/chat')` with the signal wired through; an aborted call frees Ollama's GPU queue within ~1.5 seconds (validated experimentally in prior production diagnostics; preserved as a regression test).

`classify` uses Ollama's `format` parameter to enforce the JSON Schema at the token-generation level. Invalid output is structurally impossible. The schema includes the dynamic-taxonomy mechanism (§9.2): the prompt template is rendered with the live domain list at call time; the model proposes new domains via a `facet_domain_proposed` field that triggers a review queue rather than force-fitting the existing list.

### 4.3 EmbeddingAdapter

```ts
interface EmbeddingAdapter {
  model(): { name: string; version: string; dim: number };
  embed(text: string, signal: AbortSignal): Promise<Float32Array>;
  embedBatch(texts: string[], signal: AbortSignal): Promise<Float32Array[]>;
}
```

The default uses Ollama's `nomic-embed-text` (768 dimensions, 274 MB). Each embedding records its model name and version in the document's frontmatter. A model change is detected at retrieval time; affected documents are queued for re-embedding through `corpus reindex --rebuild-embeddings`, which runs in the background without blocking search.

### 4.4 IndexAdapter

```ts
interface IndexAdapter {
  upsert(docs: Document[]): Promise<void>;        // transactional
  delete(ids: DocId[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchHit[]>;
  rebuild(): Promise<RebuildSummary>;             // from docs/ as source of truth
  vacuum(): Promise<void>;                        // periodic maintenance
}
```

Default: `SqliteIndex` over a single `.db` file containing FTS5 (BM25 with weighted columns) plus `sqlite-vec` (cosine over per-document embeddings). Every write is wrapped in a transaction; the docs row, the FTS5 row, and the vec row commit together or not at all. The Bun backend uses `bun:sqlite`; the Node backend uses `better-sqlite3`. Both backends compile SQLite with FTS5 and load `sqlite-vec` from the same compiled extension.

### 4.5 ExtractorAdapter

```ts
interface ExtractorAdapter {
  supports(input: ExtractInput): boolean;
  extract(input: ExtractInput, signal: AbortSignal): Promise<ExtractedContent>;
}
```

One implementation per input format. The registry is consulted by the pipeline; the first adapter returning `supports(input) === true` is selected. New formats are registry additions, not pipeline edits. Triage rules are encoded once in the registry rather than scattered through the pipeline:

| Input class             | Primary               | Fallback              | Reject condition              |
| ----------------------- | --------------------- | --------------------- | ----------------------------- |
| Plain text              | direct                | encoding cleanup      | empty / unreadable            |
| URL                     | headless render       | targeted readability  | block / paywall / no content  |
| HTML                    | main-content extract  | targeted cleanup      | boilerplate-only              |
| Word-processing         | pandoc                | LibreOffice           | corrupt / unreadable          |
| Ebook                   | pandoc / Calibre      | format-specific       | DRM / corrupt                 |
| Simple PDF              | text layer            | layout-aware          | no useful text                |
| Scanned PDF             | OCR                   | document-AI           | OCR confidence too low        |
| Complex PDF             | document-AI           | wisdom synthesis      | no useful content             |
| Spreadsheet (small)     | table extraction      | summary               | dataset-shaped                |
| Slide deck              | slide-text extraction | wisdom synthesis      | visual-only                   |
| Image                   | text-region detect → OCR | vision-assisted OCR | no meaningful text            |
| Audio                   | speech-detect → STT   | translation           | music / noise / no speech     |
| Video                   | subtitles → STT       | translation           | primarily visual              |
| Email                   | message parser        | thread grouping       | empty / corrupt               |
| Chat export             | export parser         | conversation grouping | unsupported shape             |
| Feed                    | feed parser           | linked-page ingest    | empty / inaccessible          |

---

## 5. The Agent Surface (read-only MCP server)

The MCP server is the agent-facing interface. It is read-only by design: the server exposes no operations that mutate the corpus. Mutations live on the CLI (§6) and are composed by skills (§7).

### 5.1 Tools

| Tool              | Signature                                      | Returns                                  |
| ----------------- | ---------------------------------------------- | ---------------------------------------- |
| `corpus.find`     | `(query: string, filter?: SearchFilter)`       | ranked list of `SearchHit`               |

`SearchFilter`:
```ts
{
  domain?: string;        // facet_domain
  type?: string;          // facet_type
  source_type?: string;
  since?: string;         // ISO 8601 date
  limit?: number;         // default 10, max 50
  mode?: 'hybrid' | 'keyword' | 'vector';  // default 'hybrid'
}
```

`SearchHit`:
```ts
{
  id: DocId;
  title: string;
  source: string;
  source_type: string;
  facet_domain: string;
  facet_type: string;
  summary: string;
  score: number;          // RRF-merged rank
  matched_fields: string[];
  matched_tier: 'hybrid' | 'keyword' | 'grep_catalog' | 'grep_body';
}
```

### 5.2 Resources

| URI                                          | Content                                                         |
| -------------------------------------------- | --------------------------------------------------------------- |
| `corpus://manifest`                          | structural overview: domain counts, total docs, recent ingest, schema version |
| `corpus://taxonomy`                          | active domains, types, source-types, top tags                   |
| `corpus://docs/{id}`                         | full document body and frontmatter                              |
| `corpus://docs/{id}/images/{n}`              | extracted image per document, fetched on demand                 |
| `corpus://list?domain=X&type=Y&since=Z`      | parametric listing filtered by facet (recency-ordered)          |
| `corpus://recent`                            | recently ingested documents                                     |
| `corpus://trash`                             | soft-deleted documents pending TTL expiration                   |

Resource URIs are URI-template valid per RFC 6570. The MCP client fetches resources on demand or auto-loads them at session start per its own caching policy. The server emits `notifications/resources/updated` when the corpus changes so clients can invalidate stale caches.

### 5.3 Prompts

| Name                | Purpose                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| `corpus.consult`    | When and how to query the corpus during a conversation; how to weave results into responses with citations. |
| `corpus.cite`       | Formatting a corpus document as a citation in the agent's response.      |
| `corpus.summarize`  | Summarizing multiple corpus documents for a single user question.        |

Prompts are server-supplied templates the agent loads at session start. They distribute the corpus's usage protocol cross-agent — answering, on the substrate side, what would otherwise require per-agent configuration.

### 5.4 Why Read-Only

Mutation operations on the MCP surface would couple agent decision-making to corpus state in ways that admit hard-to-reverse mistakes. By placing all mutations behind the CLI (and behind skills that compose CLI calls with explicit user intent), the system enforces that the user authorizes what enters and leaves the corpus, even when the agent is the convenient channel. Elicitation as an MCP-server-side safety mechanism is unused at this version because no destructive operations live on the server; if a future feature requires it, the contract is available without redesign.

---

## 6. The CLI (write surface and operational interface)

The `corpus` CLI binary is what the user invokes directly when working outside an agent session, what the autonomous-pipeline daemon invokes internally for inbox processing, and what skills shell out to for write workflows.

### 6.1 Mutation Subcommands

| Command                                         | Behavior                                                      |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `corpus ingest <url \| file \| text>`           | Pass any input the ingestion pipeline accepts; return `doc-id` (sync) or `task-id` (async, for long extractions). |
| `corpus remove <target>`                        | Soft-delete to `trash/` with default 30-day TTL. `<target>` is a `doc-id` or a filter expression (`--domain X`, `--tag Y`). |
| `corpus restore <doc-id>`                       | Lift a document out of trash back to `docs/`.                |
| `corpus remove <target> --purge`                | Hard-delete; requires explicit confirmation.                  |
| `corpus capture` and `corpus promote`           | NOT PROVIDED. Mutations of agent-derived synthesis are out of scope. |

### 6.2 Operational Subcommands

| Command                       | Behavior                                                       |
| ----------------------------- | -------------------------------------------------------------- |
| `corpus init [--import path]` | Create XDG layout, fetch defaults, run doctor; optionally import an existing Markdown directory. |
| `corpus doctor [--json]`      | Environment diagnostics + healthcheck.                         |
| `corpus daemon install`       | Write a systemd user unit (Linux), launchd plist (macOS), or document a cron equivalent (other). |
| `corpus daemon start \| stop` | Manage the watcher process directly.                           |
| `corpus mcp`                  | Start the MCP server on stdio (the same binary, a different transport). |

### 6.3 Maintenance Subcommands

| Command                                       | Behavior                                                  |
| --------------------------------------------- | --------------------------------------------------------- |
| `corpus reindex [--rebuild-embeddings]`       | Rebuild the index from `docs/` as the source of truth.    |
| `corpus reenrich [filter]`                    | Re-classify documents matching a filter; safe to interrupt and resume. |
| `corpus reconcile`                            | Detect and repair drift between disk, index, and frontmatter (§8.5). |
| `corpus telemetry [--report \| --alerts]`     | Telemetry rollups and threshold checks.                    |
| `corpus list [filter]`                        | Direct CLI listing of documents (also exposed as MCP resource). |
| `corpus search "query" [filter]`              | Direct CLI search (also exposed as MCP tool).             |
| `corpus get <doc-id>`                         | Direct CLI fetch (also exposed as MCP resource).          |

`list`, `search`, and `get` exist on the CLI for direct user use; the MCP server exposes the same operations as resources/tools by reusing the same library functions.

---

## 7. The Skill Layer

Skills are agent-environment workflow compositions installed by the user. Skills are a Claude Code capability and exist on other compatible agent platforms with similar composition shape. The corpus skill provides higher-abstraction operations the user habitually wants:

| Workflow                          | Composition                                                   |
| --------------------------------- | ------------------------------------------------------------- |
| Ingest a reading list             | Loop `corpus ingest` over user-supplied URLs with progress.   |
| Recap recent ingests              | `corpus://recent` resource + `corpus.summarize` prompt.       |
| Compose a citation set            | `corpus.find` tool + `corpus.cite` prompt + clipboard output. |
| Prune by age and domain           | `corpus list --domain X --before <date>` then confirmation, then `corpus remove`. |
| Restore a document the user remembers | `corpus list --trash` + `corpus restore <id>`.            |

A skill calls the corpus CLI for write operations and reads the corpus through the MCP server. Skills are not required for the corpus to be useful through MCP; they are an ergonomic layer above the substrate's protocol baseline. A skill written for one platform is structurally similar to a skill on another — concepts transfer.

---

## 8. The Pipeline State Machine

### 8.1 States

```
received  →  validated  →  extracted  →  routed  →  transformed  →  classified
   │                                                                     │
   ▼                                                                     ▼
failed                                                              embedded
                                                                         │
                                                                         ▼
                                                                      indexed
                                                                         │
                                                                         ▼
                                                                    reconciled
```

Every transition is a pure function of `(state, input) → next_state | error`. The state record is persisted to disk; on crash, the next drain run picks up at the last successfully completed state.

### 8.2 Transition Contracts

Every transition satisfies four properties:

1. **Idempotent.** Running the same transition on the same input twice produces the same output and no side effects beyond the first.
2. **Atomic.** Partial writes are impossible; the transition completes and the new state is durable, or it fails and the prior state is intact.
3. **Telemetry-emitting.** A structured event is appended to `Paths.telemetry()` describing the transition, its inputs (hashes, not content), and its outcome.
4. **Resumable.** A process killed mid-transition leaves the document in its prior state, recoverable on the next run.

### 8.3 Three-Folder Inbox Routing

```
inbox/pending/    files validated; queue head
inbox/processed/  ingestion succeeded
inbox/failed/     ingestion terminally failed; sidecar carries diagnostics
```

A file never remains in `pending/` after a drain run completes. Either it succeeded and is in `processed/`, or it failed terminally and is in `failed/` with a `.error.json` sidecar:

```json
{
  "schema_version": 1,
  "timestamp": "2026-04-25T...Z",
  "original_path": "<XDG_DATA>/llm-corpus/inbox/pending/foo.pdf",
  "stage": "classify",
  "error_class": "TimeoutError",
  "error_message": "classify aborted after 30000ms",
  "attempts": 3,
  "duration_ms": 91234,
  "telemetry_event_ids": ["ev-..."],
  "next_action": "manual_review"
}
```

`stage` ∈ `{validate, extract, route, transform, classify, embed, index}`.
`next_action` ∈ `{retry, manual_review, drop, ocr_fallback}`.

Failed files are replayable with `corpus drain --retry-failed`.

### 8.4 Soft Delete and Restore

`corpus remove <target>` moves matching documents to `Paths.trash()/{doc-id}/` and marks them with a `deleted_at` timestamp and a TTL (default 30 days, configurable in `config.toml`). The index marks the rows as `deleted=1` rather than removing them, so `corpus restore <doc-id>` is an O(1) flip rather than a re-index.

`corpus list --trash` shows what is in trash and the days remaining for each document. The janitor (§8.6) hard-deletes documents whose TTL has expired.

`corpus remove <target> --purge` skips the trash and hard-deletes immediately. It requires explicit confirmation when the target is a filter (rather than a single `doc-id`) and refuses to operate on more than 100 documents in a single call without an explicit `--confirm-count N`.

### 8.5 Reconciliation

`corpus reconcile` walks `docs/` and the index in parallel, detecting four classes of drift:

1. **Doc on disk, not in index** → re-index.
2. **Index row, no doc** → drop the row (soft, recoverable).
3. **Hash mismatch** (doc edited externally) → re-classify and re-index.
4. **Embedding-model mismatch** (model upgraded) → re-embed.

Reconciliation runs at `corpus init`, after `corpus reindex`, and as a scheduled background pass (default weekly).

### 8.6 The Janitor

A periodic process (run inside the daemon, or on demand) that:
- Hard-deletes documents whose trash TTL has expired.
- Sweeps stale `tmp.*` directories under `Paths.cache()` older than one hour.
- Compacts `Paths.telemetry()` when it exceeds the rotation threshold.
- Verifies `Paths.drainLock()` is owned by a live process; clears it otherwise.

### 8.7 Policies

```ts
const interactivePolicy: Policy = {
  classifyTimeoutMs: 30_000,
  transformTimeoutMs: 60_000,
  retries: 0,
  onFailure: 'throw',
  cancellable: true,
  emitProgress: true,
};

const batchPolicy: Policy = {
  classifyTimeoutMs: 30_000,
  transformTimeoutMs: 60_000,
  retries: 2,            // exponential backoff with jitter
  onFailure: 'sidecar',  // .error.json + move to failed/
  cancellable: true,     // SIGTERM cancels in-flight calls
  emitProgress: false,
};
```

Two named policies over one pipeline. Interactive callers (CLI in a terminal, MCP-driven actions if any are added later) use `interactivePolicy`. The autonomous daemon uses `batchPolicy`. There is no second copy of the pipeline functions to drift.

---

## 9. Schema (Frontmatter Contract)

This is the canonical, machine-validated contract.

### 9.1 Field Definitions

```yaml
# Identity (all required)
id:              "doc-c8cf6ea2"               # doc-{8 hex chars}, never changes
title:           "Document Title"             # original artifact title preserved
source:          "https://..." | "file:///..." # provenance record (the source location)
source_type:     article | research-paper | manual | form | video | podcast |
                 book | notes | transcript | reference
date_ingested:   "YYYY-MM-DD"
content_hash:    "sha256:..."                 # body-only hash; detects external edits

# Facets (all required)
facet_domain:    <kebab-case>                 # dynamic; queried from index at classify-time
facet_topic:     <kebab-case>
facet_type:      entity | concept | tutorial | analysis |
                 reference | synthesis | cheat-sheet
facet_stage:     raw | summarized | synthesized

# Discovery (tags + summary required)
tags:            [3..10 kebab-case keywords]
related:         []                           # doc-ids; computed by edges pass
summary:         "15-25 words; opinionated; standalone"

# Retrieval (set by pipeline)
embedding_model:    "nomic-embed-text-v1.5"
embedding_version:  1
chunked:            false
chunk_count:        0
last_indexed_at:    "ISO8601"

# Lifecycle (set by pipeline; absent for active docs)
deleted_at:      ~                             # ISO8601 if soft-deleted
delete_ttl_days: ~                             # integer if soft-deleted
```

The schema does not include `origin`, `provenance_*`, `captured_at`, or `confidence` fields. The corpus is a user-curated knowledge store; agent-derived content is the responsibility of memory-layer systems, not this substrate.

### 9.2 Dynamic Taxonomy

`facet_domain` and `tags` are open vocabularies. The substrate validates them against a runtime view of the live corpus, not a hardcoded list:

```sql
SELECT DISTINCT facet_domain, COUNT(*) AS n
FROM docs
WHERE facet_domain != '' AND deleted_at IS NULL
GROUP BY facet_domain
ORDER BY n DESC;
```

The classifier prompt is rendered with this list inline, plus an explicit instruction: *if no existing domain is appropriate, propose a new one in `facet_domain_proposed` rather than force-fitting an existing one.* Proposed domains enter a versioned `taxonomy.yml` registry where they are auto-promoted after reaching a threshold (default `N ≥ 3` documents in 30 days), manually merged into existing domains, or deprecated.

`taxonomy.yml` is versioned, append-mostly, and human-editable. It is the only place where domain aliases (e.g., `grammar → writing`) and deprecations are recorded.

### 9.3 Validation Rules

A document is schema-compliant when:

1. All required fields are present.
2. `id` matches `doc-[0-9a-f]{8}` and is unique in the index.
3. Enum-typed fields contain enumerated values only.
4. `tags` has 3–10 entries, kebab-case.
5. `summary` is non-empty.
6. `date_ingested` matches `YYYY-MM-DD`.
7. `content_hash` is sha256 over the body.
8. `embedding_model` matches the active configured embedding model (or `null` pending re-embedding).
9. `facet_domain` is non-empty (no force-fitting; propose-new is preferred to misclassification).
10. `deleted_at` and `delete_ttl_days` are either both set or both absent.

---

## 10. Hybrid Retrieval (implementation)

### 10.1 BM25 Configuration

| Field           | Weight |
| --------------- | ------ |
| `summary`       | 5      |
| `tags`          | 3      |
| `facet_topic`   | 2      |
| `title`         | 2      |
| `body_excerpt`  | 1      |

`body_excerpt` is the first 500 words of the document body. Weights are overridable in `config.toml` and reported in telemetry on every search so they can be tuned against zero-result-rate metrics over time.

### 10.2 Dense Vector Search

Per-document embeddings of the concatenation `(title + summary + facet_topic + tags + body_excerpt)`. Cosine similarity, normalized scores. Document-level granularity at this version; chunked-body embeddings are on the roadmap when documents exceed a configurable word threshold.

### 10.3 Reciprocal Rank Fusion

```
score(doc) = sum over retrievers r of  1 / (k + rank_r(doc))    where k = 60
```

Standard RRF; no score normalization required. Each retriever returns its top-k and the fusion produces the merged top-k.

### 10.4 Knowledge-Graph Edges

Edges are materialized at index time from three signals:
1. **Tag overlap** — Jaccard coefficient between `tags` arrays.
2. **Summary-embedding cosine similarity** — over the same vector index.
3. **Explicit `related` arrays** — frontmatter-declared cross-references.

Stored in an `edges(src_id, dst_id, kind, weight)` table. Exposed through the `corpus list --related-to <doc-id>` CLI subcommand and the `corpus://list?related_to=<doc-id>` MCP resource.

### 10.5 Confidence-Weighted Ranking

Per-source-type priors (configurable in `config.toml`):

```toml
[confidence_weights]
research-paper = 1.20
manual         = 1.10
form           = 1.10
reference      = 1.10
article        = 1.00
notes          = 0.95
transcript     = 0.90
podcast        = 0.90
video          = 0.90
book           = 1.05
```

Recency boost: documents ingested in the last 90 days get a `+0.05` multiplier (configurable). Recency penalty: documents whose `last_indexed_at` is older than the schema-version bump receive a `-0.10` penalty until reconciled. Confidence-weighted ranking is applied after RRF fusion; the ranker does not need access to provenance because it operates entirely on existing facets.

### 10.6 Tier Model

| Tier  | Method                                       | Latency target | Coverage                                   |
| ----- | -------------------------------------------- | -------------- | ------------------------------------------ |
| 0     | Hybrid (BM25 ⊕ vector ⊕ graph ⊕ confidence)  | < 20 ms        | metadata + body excerpt + semantic + edges |
| 1     | BM25 only                                    | < 5 ms         | indexed text fields                        |
| 2     | Body grep over `CATALOG.md`                  | < 50 ms        | all summaries + domains                    |
| 3     | Filesystem grep across `docs/`               | < 500 ms       | full document body                         |

A query returning fewer than `min_results` hits at tier 0 falls through to lower tiers within an aggregate latency budget. The caller sees one result set; the matched tier is reported in hit metadata.

---

## 11. Concurrency, Cancellation, Cleanup

### 11.1 Advisory Lock

A single advisory lock at `Paths.drainLock()` serializes drain runs. Drain acquires the lock with `flock(LOCK_EX | LOCK_NB)`; if held, drain emits a `lock_contention` telemetry event and exits 0. Watchers (file-system watcher, systemd timer, cron job) are decoupled from the lock — they trigger drain; drain decides whether to run.

### 11.2 Cancellation

A single root `AbortController` is created at drain entry. Its signal is propagated through every external call: extractor subprocess, Ollama HTTP call, embedding HTTP call, index write. SIGTERM and SIGINT trigger `controller.abort()`; the in-flight document is marked `failed` with cause `aborted`, state is persisted, and drain exits cleanly.

### 11.3 Tmp-Directory Lifecycle

`withTempDir(async dir => { ... })` is the only sanctioned way to allocate a tmp directory. It creates the directory under `Paths.cache()`, runs the body, and cleans up in `try/finally`. A SIGTERM handler runs the same cleanup before exit. The janitor (§8.6) sweeps stale tmp directories older than one hour.

### 11.4 Atomic Writes

```ts
export async function atomicWrite(target: string, data: Buffer | string, mode = 0o644) {
  const tmp = `${target}.tmp.${process.pid}.${randomBytes(2).toString('hex')}`;
  const fh = await open(tmp, 'w', mode);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, target);
  // fsync the parent directory to make the rename durable
  const dir = await open(dirname(target), 'r');
  try { await dir.sync(); } finally { await dir.close(); }
}
```

The tmp suffix carries the writer's PID and entropy bytes; concurrent writers cannot collide. The parent-directory fsync after rename closes the durability gap that bare `rename` leaves on most Linux filesystems.

---

## 12. Observability

### 12.1 Telemetry Event Stream

`Paths.telemetry()` is an append-only JSONL file. Every catch block in the pipeline emits a structured event before throwing or returning. The event taxonomy:

| Event                | Fields                                                       |
| -------------------- | ------------------------------------------------------------ |
| `validate_pass`      | filename, ext, size, mime                                    |
| `validate_reject`    | filename, reason                                             |
| `ingest_start`       | doc_id, source_type                                          |
| `ingest_complete`    | doc_id, source_type, word_count, duration_ms                 |
| `ingest_fail`        | doc_id, stage, error_class, error_message                    |
| `transform_start`    | doc_id, pattern, depth                                       |
| `transform_complete` | doc_id, pattern, depth, chunk_count, duration_ms             |
| `classify_complete`  | doc_id, model, domain, duration_ms                           |
| `index_upsert`       | doc_id, duration_ms                                          |
| `search_query`       | query_text, tier_used, result_count, duration_ms             |
| `remove`             | doc_id, mode (soft \| purge), target_kind                    |
| `restore`            | doc_id                                                       |
| `escalate`           | doc_id, stage, escalated_to                                  |
| `gc_swept`           | path_count, duration_ms                                      |
| `lock_contention`    | held_by, age_seconds                                         |
| `drain_summary`      | processed, failed, skipped, duration_ms                      |
| `reconcile_summary`  | drift_count, repairs_attempted, repairs_succeeded            |

### 12.2 Healthcheck

```bash
$ corpus doctor --json
{
  "status": "ok",
  "version": "1.0.0",
  "paths": { "data": "...", "state": "...", "config": "...", "cache": "..." },
  "ollama": { "reachable": true, "models": ["qwen3:8b","nomic-embed-text"], "vram_used_gb": 8.4 },
  "index":  { "doc_count": 513, "trash": 12, "last_upsert": "...", "size_mb": 12.3 },
  "library":{ "docs": 513, "pending": 0, "failed": 0, "orphan_tmp": 0 },
  "drain":  { "last_run": "...", "last_status": "ok", "lock_held": false }
}
```

`doctor` exits 0 (`ok`), 1 (`degraded`), or 2 (`down`).

### 12.3 Alert Thresholds

Reported by `corpus telemetry --alerts` and configurable in `config.toml`:

- Classification success rate < 90% over a rolling 1 h window.
- p95 transform latency > 30 s for 3 consecutive runs.
- `failed/` count > 10.
- Ollama unreachable for 3 successive probes.
- Drain run > 80 % of the configured per-batch timeout.
- Lock-contention events > 0 in the last 10 minutes.

---

## 13. Testing Pyramid

### 13.1 Unit (~60 % of test mass)

Pure functions only. Fast (under one second total). Run on every commit.

- Frontmatter codec round-trip (parse → mutate → serialize → parse, byte-equal) including unicode, multiline, leading dashes, weird quoting.
- Depth router: exhaustive `(source_type × word_count tier)` table.
- URL normalizer: case-fold host only, preserve path/query case, fragment stripping, YouTube canonicalization.
- Atomic-write: parent fsync, suffix uniqueness, mode preservation, ENOSPC.
- Doc-id collision frequency at 1 M draws (statistical bound).
- FTS5 query preprocessor: alphanumeric tokens get `*`; special characters get quoted; FTS5 operators pass through.
- RRF merge: identity on a single retriever; monotonicity on rank inputs.

### 13.2 Integration (~30 %)

Real SQLite, mocked Ollama. Fixture inbox.

- 20-document end-to-end pipeline pass (one per source_type).
- Concurrent ingest of the same URL — exactly one writes; others see duplicate.
- Concurrent FTS5 upsert — index stays consistent.
- Drain crash mid-document (`kill -9`) — next run picks up cleanly.
- Ollama timeout abort — GPU queue free within 2 s of signal.
- Soft-delete + restore round-trip — index flag flips correctly; trash list matches.

### 13.3 End-to-End (~10 %)

Real Ollama, real model, gated nightly.

- 8-PDF regression set: all 8 land with non-empty domain, summary, tags ≥ 3.
- Image-only PDF: must trigger OCR fallback, not silently produce a 16-word body.
- 50-query retrieval harness with known relevant documents: hit-rate ≥ 0.85.

### 13.4 Lint Gates

- No `process.exit` in `packages/{contracts,core,storage,index,inference,extract,pipeline}/`.
- No string literal matching `/^/data/` outside `Paths`.
- Every `catch` block in the pipeline emits a telemetry event (AST check).
- No `Promise.race` against a `setTimeout` — must use `AbortController`.
- No `execSync` against a string-formed shell command — must use `spawn` with arg array.
- No reference to `corpus capture`, `provenance_*`, or `origin: agent` (operations and fields explicitly out of scope).

---

## 14. Build Plan

The implementation proceeds through five sequential epics. No epic begins until the prior one's exit criterion is met.

**Epic 1 — Foundations and contracts.** Monorepo setup with strict TypeScript, the XDG `Paths` resolver, structured logging, the telemetry library, the `Result<T,E>` type, `withTempDir`, `atomicWrite`, the YAML codec, and lint rules. **Exit:** 100 % unit-test coverage on these primitives; lint blocks every forbidden pattern.

**Epic 2 — Storage and index.** Document schema, SQLite schema (FTS5 + sqlite-vec), `IndexAdapter` with transactional upsert, `StorageAdapter` with atomic writes and soft-delete/restore, source-index with file-locked appends, the rebuild path, the migration framework, the reconciler skeleton. **Exit:** integration tests pass for concurrent upsert, crash-mid-write, round-trip identity, and soft-delete/restore.

**Epic 3 — Inference layer with cancellable IO.** Ollama client over `fetch` + `AbortController` (no npm `ollama` package), health probe, queue-depth metric, per-task config from environment variables. Depth router and paragraph-aware chunker. Classify, transform, and vision as pure functions. Cloud-fallback hook. **Exit:** kill-test passes (abort frees Ollama queue within 2 s); ten parallel timeouts do not deadlock.

**Epic 4 — Pipeline and control plane.** Single `ingestOne(input)` library function. CLI wrappers (`ingest`, `remove`, `restore`, `reindex`, `reenrich`, `list`, `search`, `get`). The drain is a thin loop over `ingestOne`. Three-folder routing, advisory lock, signal handlers, soft-delete + TTL janitor. **Exit:** the 8-PDF regression set passes; no leaked tmp directories after `kill -9`; idempotent on re-run.

**Epic 5 — Operations and quality.** The MCP server (`corpus mcp`) exposing tools/resources/prompts. The validator (schema-driven, queries live taxonomy). The install script (`corpus init`). `corpus doctor`. The telemetry rollups and dashboard. The skill scaffolding for the corpus skill. **Exit:** end-to-end suite is green; the operations runbook is complete; v1.0 is shippable.

---

## 15. Non-Negotiable Contracts

These contracts hold the system to the failure modes its design exists to prevent. They are enforced by lint, by integration tests, or by code review; none is optional.

1. **Cancellable IO.** Every external call uses `AbortController`. Timeouts clear timers on success.
2. **Single-writer drain.** Advisory lock; concurrent invocations exit cleanly with telemetry.
3. **No `process.exit` in libraries.** Library functions return `Result<T, E>` or throw typed errors. CLI wrappers may exit.
4. **One pipeline.** Interactive and batch invoke the same in-process library; the difference is policy, not code path.
5. **XDG paths only.** Single resolver; lint rejects literal `/data/` strings or hardcoded `llm-corpus` paths outside `Paths`.
6. **Real YAML codec.** Frontmatter routes through one library; no hand-rolled string replacement.
7. **Atomic writes are atomic and durable.** `tmp + fsync + rename + dirsync`; pid-and-entropy suffix.
8. **Transactional index updates.** FTS5, docs, and vec rows commit together or not at all.
9. **Three-folder routing.** Every failure produces a `.error.json` sidecar; no file remains in `pending/` after a drain run.
10. **Telemetry-or-die.** Every catch block emits a structured event (lint-checked).
11. **Concurrency-safe shared state.** Append-atomic JSONL writes (≤ 4 KB) or file locks; SQLite WAL mode.
12. **Subprocess hygiene.** `spawn` with arg arrays; one `runTool(name, args[])` helper.
13. **Tmp-dir lifecycle owned by one helper.** `withTempDir` guarantees cleanup on success, exception, and signal.
14. **Schema-driven taxonomy.** Domains are queried at runtime from the live corpus; zero hardcoded domain enums.
15. **Idempotency.** Re-running drain on the same input file produces no duplicates.
16. **Bounded execution.** Per-call, per-doc, and per-batch timeouts; Ollama queue depth observed.
17. **Read-only MCP.** The MCP server exposes no operations that mutate the corpus. Mutations live on the CLI.
18. **No agent-derived content in the schema.** The schema does not record `origin`, `provenance_*`, or `confidence`. The corpus is user-curated only.

---

*Companion document: `WHITEPAPER-FINAL.md` (idea, motivation, design principles).*
