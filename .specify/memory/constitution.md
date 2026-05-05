<!--
SYNC IMPACT REPORT — llm-corpus Constitution

Version change: (template) → 1.0.0
Initial ratification of the project constitution.

Sources of derivation (all at git tag `pre-speckit-archive`, commit 672c009):
  - WHITEPAPER-FINAL.md (project intent, abstract)
  - .product/CHARTER.md (immutable original intent + SHA-256 provenance of WHITEPAPER-FINAL.md)
  - .product/ANTI-GOALS.md (5 anti-goals: AG-001 through AG-005)
  - ARCHITECTURE-FINAL.md §14 (5-epic build plan) + §15 (18 non-negotiable contracts)

Drafting/critique trail:
  - Drafted as 10 principles, critiqued by an Architect agent + RedTeam adversarial
    pass + Engineer cross-template consistency check, then revised to 16 principles
    after the critiques surfaced six uncovered §15 contracts, six exploitable carve-outs
    (Principles I-IV), one principle-pair tension (V×II), and one unrepresented anti-goal
    cluster (AG-004/AG-005). The pre-revision draft is preserved in git history.

Modified principles (initial creation, no prior version):
  N/A — this is v1.0.0

Added sections:
  - Core Principles (16 numbered principles, I–XVI; all NON-NEGOTIABLE)
  - Section 2: Source-of-Truth Hierarchy
  - Section 3: Development Workflow
  - Governance

Removed sections:
  - All template placeholders ([PROJECT_NAME], [PRINCIPLE_N_NAME], etc.)

Templates updated alongside this constitution (in same commit):
  ✅ updated — `.specify/templates/plan-template.md` (Constitution Check gate populated
    with one checkbox per principle I–XVI; replaces the prior `[Gates determined based
    on constitution file]` placeholder).
  ✅ updated — `.specify/templates/spec-template.md` (SC-002 example replaced — prior
    "1000 concurrent users" example drifted toward multi-user; new example is
    single-user/single-machine).
  ✅ updated — `.specify/templates/tasks-template.md` (tests-optional phrasing patched
    with project-specific note that tests are MANDATORY for tasks touching IO,
    classifier output, telemetry, paths, taxonomy, or schema).
  ✅ aligned — `.specify/templates/checklist-template.md` (content-agnostic, no update needed).
  ✅ aligned — `.specify/templates/constitution-template.md` (source template; only the
    materialized constitution.md changes during ratification).

Coverage matrix (each ARCHITECTURE-FINAL §15 contract → principle that governs it):
  §15.1  Cancellable IO            → Principle VII
  §15.2  Single-writer drain       → Principle IX (concurrency-safe shared state)
  §15.3  No process.exit in libs   → Principle XI (Library/CLI boundary)
  §15.4  One pipeline              → Principle VI
  §15.5  XDG paths only            → Principle XIV
  §15.6  Real YAML codec           → Principle V (schema-enforced)
  §15.7  Atomic writes             → Principle VIII
  §15.8  Transactional index       → Principle VIII
  §15.9  Three-folder routing      → Principle X (idempotent transitions)
  §15.10 Telemetry-or-die          → Principle XIII
  §15.11 Concurrency-safe state    → Principle IX
  §15.12 Subprocess hygiene        → Principle XII
  §15.13 Tmp-dir lifecycle         → Principle VIII (atomic writes)
  §15.14 Schema-driven taxonomy    → Principle XV
  §15.15 Idempotency               → Principle X
  §15.16 Bounded execution         → Principle VII (cancellable IO)
  §15.17 Read-only MCP             → Principle III
  §15.18 No agent-derived content  → Principle II

Anti-goal coverage:
  AG-001 No human UI               → Principle III
  AG-002 No LLM-rewritten content  → Principle II
  AG-003 No memory/SaaS/multi-user → Principle IV
  AG-004 No cross-agent claims     → Principle XVI (Validation Honesty)
  AG-005 No eval harness in v1     → Principle XVI (Validation Honesty)

Follow-up TODOs:
  - `.product/` archive is frozen as of git tag `pre-speckit-archive` (commit 672c009).
    Subsequent edits to `.product/` are non-canonical; the principles below are the
    system of record from this point forward.
  - The AST-level lint enforcing Principle XIII is named here as a Phase-1 deliverable;
    until it ships, every catch block requires a code-review checklist tick.

Provenance:
  - Authored by Pallas Athena (Claude Opus 4.7) under Algorithm v3.7.0 invocation
    of speckit-constitution against sources at pre-speckit-archive
  - Critiqued by Architect agent + RedTeam ParallelAnalysis + Engineer cross-template check
  - Ratified 2026-05-05 by Shon Stephens
-->

# llm-corpus Constitution

llm-corpus is a local-first knowledge substrate for AI terminal agents. It normalizes the user's documents to Markdown with structured frontmatter, classifies them through a local language model with token-level grammar enforcement, and indexes them under hybrid retrieval inside a single SQLite file. A read-only Model Context Protocol server exposes the corpus to any MCP-aware agent. The system runs entirely on the user's machine.

This constitution is the project's governing document. Every feature specification, implementation plan, task list, and pull request MUST pass these 16 principles before merge. Violations require explicit Complexity Tracking justification per the plan template, citing which principle is violated, why the violation is necessary, and what simpler alternative was rejected.

## Core Principles

### I. Local-First, No Egress (NON-NEGOTIABLE)

The corpus runs entirely on the user's machine. No document body, frontmatter, embedding, classification result, query string, or telemetry datum MAY be transmitted to any non-localhost network endpoint during normal operation. The default `InferenceAdapter` MUST be a local Ollama process. The default `EmbeddingAdapter` MUST be a local Ollama process. The default `IndexAdapter` MUST be a local SQLite file.

Cloud-fallback inference, cloud-embedding adapters, and any other code path that reaches a non-localhost destination are FORBIDDEN in v1.0.0. Adapter *interfaces* MAY be designed such that a future v2.0.0 amendment could enable remote providers, but v1.0.0 MUST NOT ship code that transmits document content (or hashes thereof if reversible), classification prompts, query strings, or embeddings off-machine. Reaching a non-localhost destination is an automatic constitutional violation regardless of feature flags, opt-in switches, or telemetry instrumentation.

**Rationale:** Whitepaper abstract + Architecture §2 + AG-003. The whole positioning of the project is local-first; carve-outs swallow the rule.

### II. User Curates, LLM Classifies Metadata (NON-NEGOTIABLE)

The user is the sole authority on what enters the corpus and on what each document body says. The LLM produces *frontmatter metadata* (summary, tags, facets, domain) — that is the classification output and is permitted. The LLM MUST NOT produce, rewrite, or synthesize *document bodies* into the canonical store. The frontmatter schema MUST NOT include `origin`, `provenance_*`, `confidence`, `captured_at`, or `corpus capture` fields.

A `synthesis/` namespace, an AI-derived corpus, or LLM-generated documents as a `corpus.find` retrieval target are FORBIDDEN in v1.0.0. Future-tense references to such a namespace in design documents are *design-space description*, NOT present permission. Introducing them requires constitutional amendment to v2.0.0 with explicit anti-goal AG-002 revisit.

**Rationale:** AG-002 + Whitepaper §2.3. Metadata-vs-body is the hinge; without this distinction Principles V (schema-enforced) and II are in tension.

### III. Substrate, Not Surface (NON-NEGOTIABLE)

llm-corpus has exactly two surfaces: the `corpus` CLI binary (one-shot text input/output only) and the MCP stdio transport. The system MUST NOT introduce:

- Any HTTP server other than the MCP stdio transport. The MCP server MUST NOT bind to a TCP port for normal operation.
- Any TUI (terminal user interface) mode. CLI subcommands emit one-shot text; they MUST NOT enter an interactive screen, REPL, or curses-style buffer.
- Any browser-rendered admin, dashboard, debugging, or diagnostics interface.
- Any process that emits HTML, renders graphical output, or serves static assets.
- Any agent-facing mutation surface. The MCP server MUST be read-only by design and MUST NOT expose any tool, resource, or prompt that mutates the corpus. All write operations MUST live on the `corpus` CLI binary; skills compose CLI calls under explicit user intent.

**Rationale:** AG-001 + Architecture §5.4 + §15.17. The agent IS the UI; cross this line and llm-corpus becomes Obsidian/NotebookLM/AnythingLLM/Logseq AI — products that already exist and are explicitly NOT what this is.

### IV. Knowledge, Not Memory; Single-User, Single-Machine (NON-NEGOTIABLE)

The corpus is durable user-curated domain knowledge — the *experience problem*. It is NOT a conversation-memory store, an agent-personality layer, or a behavioral-preference cache (those address the *personality problem* and belong to Mem0/Letta/auto-memory).

The system MUST be designed for a single human user operating from a single machine. FORBIDDEN: shared `CORPUS_HOME` across users or accounts; any feature that egresses corpus state for cross-user, cross-account, or cross-machine access; any concept of "permissions," "access control," "roles," "team workspaces," or "multi-device coordination"; any SaaS connector. Multi-device use by the same user is permitted only through user-invoked filesystem operations (rsync to USB drive, manual scp); no in-system feature MAY automate cross-machine state replication or remote sync.

The frontmatter schema MUST NOT include conversation memory, agent state, or per-session preference fields.

**Rationale:** AG-003 + Whitepaper §4. The narrow term "team-account model" was inadequate; the principle is shape-based.

### V. Schema-Enforced Structured Output (NON-NEGOTIABLE)

Classification output MUST be structurally constrained at the token-generation level via Ollama's `format` parameter rendered with the canonical Zod-derived JSON Schema. Invalid metadata is structurally impossible, not merely unlikely. Frontmatter validation rejects schema-noncompliant documents at index time.

No feature MAY introduce post-hoc string parsing, regex extraction from free-form LLM output, or "best-effort" structured-output workarounds. Frontmatter MUST route through one YAML library; no source file MAY hand-roll YAML string replacement, frontmatter mutation, or quoting logic.

**Rationale:** Architecture §4.2 + §9 + §15.6 + §15.18. Grammar-enforced classification is the system's primary technical contribution.

### VI. One Pipeline, Two Policies (NON-NEGOTIABLE)

Interactive (CLI in terminal) and autonomous (daemon-driven) ingestion MUST share the same in-process library code. They differ only via named `Policy` objects (`interactivePolicy` vs `batchPolicy`) governing timeouts, retries, failure handling, cancellability, and progress emission. No feature MAY fork the pipeline into a parallel implementation; behavior changes go in policy fields, not code paths.

**Rationale:** Architecture §15.4 + §8.7. A second pipeline guarantees a second source of bugs.

### VII. Cancellable, Bounded IO (NON-NEGOTIABLE)

Every external IO call (extractor subprocess, Ollama HTTP call, embedding HTTP call, index write, filesystem operation) MUST take an `AbortSignal` and propagate it through. Timeouts MUST clear timers on success. SIGTERM/SIGINT MUST trigger `controller.abort()`; in-flight operations MUST mark themselves `failed` with cause `aborted`, persist state, and exit cleanly within 2 seconds. Every call MUST be bounded: per-call, per-document, and per-batch timeouts MUST be configurable and observed; the Ollama queue depth MUST be observable via telemetry.

`Promise.race` against a `setTimeout` is FORBIDDEN; use `AbortController`. `execSync` against a string-formed shell command is FORBIDDEN.

**Rationale:** Architecture §11 + §15.1 + §15.16. Without cancellability, kill-test fails and the GPU queue stalls.

### VIII. Atomic Writes & Transactional Index Updates (NON-NEGOTIABLE)

Every disk write MUST be atomic via `tmp + fsync + rename + dirsync` with PID-and-entropy temp suffixes (`.tmp.{pid}.{rand4hex}`) so concurrent writers cannot collide on a temp path. Index writes (FTS5 row + docs row + `sqlite-vec` row for the same document) MUST commit together in a single transaction or not at all; partial index state is a forbidden permitted state.

Tmp-directory allocation MUST go through `withTempDir(async dir => { ... })`, the only sanctioned helper, which guarantees cleanup on success, exception, and SIGTERM. Stale tmp directories under `Paths.cache()` older than one hour are swept by the janitor.

**Rationale:** Architecture §11.4 + §15.7 + §15.8 + §15.13. Partial writes corrupt the corpus; a non-atomic index produces phantom hits or missing matches.

### IX. Concurrency-Safe Shared State (NON-NEGOTIABLE)

The `corpus` drain process serializes via a single advisory lock at `Paths.drainLock()` acquired with `flock(LOCK_EX | LOCK_NB)`; concurrent invocations exit cleanly with a `lock_contention` telemetry event. Watchers (filesystem watcher, systemd timer, cron job) trigger drain; drain decides whether to run.

SQLite MUST run in WAL (Write-Ahead Logging) mode. Append-only JSONL writes (telemetry, source-index, ledgers) MUST be `≤ 4 KB` per record so the `O_APPEND` write is atomic on POSIX filesystems; larger records MUST use file locks. No source file MAY introduce a shared-state primitive (file, named pipe, shared memory) that bypasses these mechanisms.

**Rationale:** Architecture §11.1 + §15.2 + §15.11. Corruption from concurrent unsynchronized writes is silent and unrecoverable.

### X. Idempotent Pipeline Transitions; Three-Folder Routing (NON-NEGOTIABLE)

Every pipeline transition (validate → extract → route → transform → classify → embed → index → reconcile) MUST be a pure function `(state, input) → next_state | error`. Re-running the same transition on the same input MUST produce the same output and no side effects beyond the first.

The inbox uses a three-folder model: `pending/` (validated; queue head), `processed/` (succeeded), `failed/` (terminally failed with `.error.json` sidecar). No file MAY remain in `pending/` after a drain run completes. Failed files MUST be replayable with `corpus drain --retry-failed`.

**Rationale:** Architecture §8.2 + §8.3 + §15.9 + §15.15. Without idempotency, a kill-9 mid-drain produces duplicate documents on the next run.

### XI. Library/CLI Boundary; No `process.exit` in Libraries (NON-NEGOTIABLE)

Source files under `packages/{contracts,core,storage,index,inference,extract,pipeline}/` MUST NOT contain `process.exit`. Library functions MUST return `Result<T, E>` or throw typed errors. Only CLI wrappers (`packages/cli/`, `packages/transport/`) and the daemon entry point (`packages/daemon/`) MAY exit the process. CI lint enforces this.

**Rationale:** Architecture §15.3. A `process.exit` inside a library function makes that function untestable in-process and breaks the MCP server's request-handler isolation.

### XII. Subprocess Hygiene (NON-NEGOTIABLE)

Subprocess invocation MUST go through a single `runTool(name: string, args: string[], opts: SpawnOptions)` helper that uses `spawn` with an argument array. `execSync`, `exec`, and any string-formed shell command are FORBIDDEN. The helper MUST propagate `AbortSignal`, capture stdout/stderr separately, and emit a `tool_invoked` telemetry event with the binary name (not the full args) and exit code.

**Rationale:** Architecture §15.12. String-formed shell commands are command-injection vectors and silent-failure points.

### XIII. Telemetry-or-Die (NON-NEGOTIABLE)

Every catch block in any source file under `packages/` MUST emit a structured event to `Paths.telemetry()` before throwing or returning, with severity matching the actual error severity (no downgrading errors to `debug`/`info` to silence alerts). Every state transition MUST emit a telemetry event describing inputs (hashes, not content), outcome, and duration. Every search query MUST emit a `search_query` event with `tier_used` and `result_count`.

No wrapper, decorator, middleware, or higher-order function MAY swallow exceptions before they reach a per-file catch block. AST-level lint enforcing this is a Phase-1 deliverable; until it ships, every catch block requires a code-review checklist tick on the PR.

**Rationale:** Architecture §12 + §15.10. Silent failure is the worst kind of failure: the system reports success while the user gets no value.

### XIV. XDG Paths via Single Resolver (NON-NEGOTIABLE)

Every filesystem path the system reads or writes MUST be reachable through `Paths.{data,state,config,cache}()` (or one of its derived getters). The single override the user MAY set is `CORPUS_HOME` to relocate the data root.

Writes to `/tmp/`, `/var/`, `os.tmpdir()`, system root paths, or any location not explicitly under `Paths.*` are FORBIDDEN regardless of whether they appear as string literals, dynamically constructed paths, or `path.join()` arguments. The system MUST require no root privilege at any point and MUST write nothing outside the user's home directory (`$HOME`).

**Rationale:** Architecture §2.1 + §15.5. One place that knows where things live; one place to change when the layout evolves.

### XV. Dynamic Taxonomy with User-Reviewed Promotion (NON-NEGOTIABLE)

`facet_domain` and `tags` are open vocabularies. The classifier prompt MUST be rendered at call time with the result of a `SELECT DISTINCT facet_domain` query against the live corpus. New domains enter the system via a `facet_domain_proposed` field that places the proposal into a *user-review queue* — a domain MUST NOT be auto-promoted to active status without an explicit user-review acknowledgment, even after meeting any frequency threshold (`N ≥ 3` documents in 30 days is a *gate*, not an *auto-trigger*).

No source file MAY contain a hardcoded `enum FacetDomain { ... }` or equivalent fixed list. The `taxonomy.yml` registry at `Paths.data() + 'taxonomy.yml'` is the only place where domain aliases, promotions, and deprecations are recorded.

**Rationale:** Architecture §9.2 + §15.14. Auto-promotion is a quiet way to expand the domain space without user awareness.

### XVI. Validation Honesty (NON-NEGOTIABLE)

The system MUST NOT make claims of capability, compatibility, or quality that have not been user-validated.

- **Cross-agent claims:** Documentation, README, marketing copy, and CLI `--help` output MUST NOT claim cross-agent compatibility (Gemini CLI, Codex CLI, local LLMs other than the user's primary agent) as a *user-validated* feature in v1.0.0. MCP protocol portability is a property of the protocol, not a guarantee of the user experience. Cross-agent claims become permitted only after a second user with a different primary agent has installed and used the corpus for ≥ 30 days and reported outcomes.
- **Retrieval evaluation:** v1.0.0 MUST NOT include a formal retrieval evaluation harness as a success criterion. The whitepaper-listed "50-query labeled benchmark" is Future Work (v1.5+). v1.0.0 ships with a measurable-today metric (queries-per-week with user acceptance). Adding the formal harness as a v1 deliverable conflates substrate development with evaluation methodology.
- **Performance claims:** Latency targets cited in ARCHITECTURE-FINAL §10.6 (Tier 0 < 20 ms, Tier 1 < 5 ms, Tier 2 < 50 ms, Tier 3 < 500 ms) are *targets*, not guarantees. README and CLI output MUST NOT cite them as guarantees without a benchmark suite in CI confirming them on the primary user's hardware.

**Rationale:** AG-004 + AG-005. Marketing-vs-engineering drift is the single largest risk to a one-developer project; this principle exists to prevent it from accumulating in v1.0.0.

## Source-of-Truth Hierarchy

When two artifacts disagree, the higher-numbered authority wins. (Lower numbers are reference; higher numbers are governing.)

1. `WHITEPAPER-FINAL.md` — informational; the project's abstract positioning. Edits permitted but never authoritative.
2. `.product/CHARTER.md` — **immutable**. Captures original intent at creation time with SHA-256 of WHITEPAPER-FINAL.md. Modification is forbidden; supersession requires a versioned `CHARTER-v2.md` with `supersedes:` frontmatter.
3. `.product/` artifacts other than CHARTER.md — **frozen as of git tag `pre-speckit-archive`** (commit 672c009). Reference-only from this point forward; subsequent edits are non-canonical and non-authoritative for new decisions.
4. `ARCHITECTURE-FINAL.md` — **frozen alongside `.product/`** at `pre-speckit-archive`. Reference-only for engineering specifics; further architectural specifics belong in ADRs under `.specify/specs/NNN-{slug}/contracts/` (per-feature) or amendments to this constitution (cross-cutting).
5. **This constitution** (`.specify/memory/constitution.md`) — the project's governing principles. Amendments per the Governance section below.
6. `.specify/specs/NNN-{slug}/spec.md` — per-feature specifications produced by `/speckit-specify`.
7. `.specify/specs/NNN-{slug}/plan.md` — per-feature implementation plans produced by `/speckit-plan`. MUST pass Constitution Check gate.
8. `.specify/specs/NNN-{slug}/tasks.md` — per-feature task breakdowns produced by `/speckit-tasks`.

The `.product/` deep-tier ProductDevelopment package (Charter, PRD, Requirements, ADRs 001-008, Sprint Plan, Acceptance Criteria, Test Plan, Risk Register, Roadmap, handoffs, ledgers) and ARCHITECTURE-FINAL.md **seeded** this constitution and the per-feature specifications. They are the design-archive of why the project exists in this shape, not the system of record for what to build next.

## Development Workflow

**Feature lifecycle:**

1. `/speckit-specify "feature description"` — creates `.specify/specs/NNN-{slug}/spec.md` and a feature branch `NNN-{slug}` (per `.specify/extensions.yml → before_specify → speckit.git.feature` mandatory hook).
2. `/speckit-clarify` — *optional*; runs structured Q&A to de-risk ambiguous areas.
3. `/speckit-plan` — produces `plan.md` after a **Constitution Check gate** (16 checkboxes, one per principle I–XVI; any violation requires Complexity Tracking justification).
4. `/speckit-tasks` — produces `tasks.md` from the locked plan.
5. `/speckit-checklist` — *optional*; generates quality checklists.
6. `/speckit-analyze` — *optional*; cross-artifact consistency check before implementation.
7. `/speckit-implement` — executes tasks in order.

**Commit discipline:**

- Conventional Commits format (`feat(scope): subject`, `fix(scope): subject`, etc.).
- Every commit on a feature branch references the feature `NNN-{slug}` in either the branch name or the commit body.
- Pre-commit hooks (when configured) run on every commit; `--no-verify` is FORBIDDEN.
- Force-push to `main` is FORBIDDEN. Feature branches MAY be force-pushed by the author up until merge.
- Auto-commit hooks (`speckit.git.commit` before clarify/plan/tasks/implement/checklist) are *optional*; the user MAY decline at the prompt.

**Constitution Check gate (per /speckit-plan invocation):**

Each plan MUST include a Constitution Check section with one checkbox per principle (I–XVI). A passing plan has every checkbox marked. A plan that violates one or more principles MUST populate the Complexity Tracking section with: (a) which principle is violated, (b) why the violation is necessary, (c) what simpler alternative was rejected and why. A plan with unjustified violations MUST NOT be merged. The plan template at `.specify/templates/plan-template.md` carries the canonical 16-checkbox skeleton.

## Governance

**Amendment procedure:**

1. Author proposes an amendment with: (a) version bump per semver below, (b) rationale, (c) Sync Impact Report at the top of `.specify/memory/constitution.md` documenting modified/added/removed principles, (d) cross-template consistency review (plan/spec/tasks/checklist templates).
2. Amendments touching a NON-NEGOTIABLE principle (which is all 16) MUST explicitly cite which AG-NNN anti-goal or ARCHITECTURE-FINAL §15 contract is being relaxed and why the relaxation is necessary.
3. Amendment is committed as a single commit `feat(constitution): amend to vX.Y.Z (summary)`.
4. The `LAST_AMENDED_DATE` footer field is updated to the commit date. The `RATIFICATION_DATE` field stays at the original ratification.

**Versioning (semver applied to governance):**

- **MAJOR (X.0.0)** — backward-incompatible changes: removing a principle, redefining a principle in a way that invalidates existing plans, removing a section that prior plans relied on.
- **MINOR (x.Y.0)** — backward-compatible additions: new principle, new section, materially expanded guidance within an existing principle.
- **PATCH (x.y.Z)** — clarifications, wording, typo fixes, non-semantic refinements that do not change what plans must satisfy.

**Compliance review:**

- Every `/speckit-plan` invocation runs a Constitution Check gate. Violations are tracked in the plan's Complexity Tracking section and reviewed before tasks are generated.
- Every pull request (when used) MUST cite which principles the change touches and confirm the Constitution Check gate still passes for any affected plans.
- This constitution supersedes ad-hoc decisions made during implementation. Any conflict between an implementation pattern and a principle resolves to the principle. The principle is amended via the amendment procedure above, not silently overridden.

**Conflicts with anti-goals:**

If a future feature proposal conflicts with one of the 5 anti-goals (`.product/ANTI-GOALS.md` AG-001 through AG-005, frozen as of `pre-speckit-archive`), the proposal MUST cite the conflicting `AG-NNN` and either: (a) be redesigned to remove the conflict, or (b) trigger explicit anti-goal revisit per the anti-goal's own `revisit_condition` field, which in turn triggers a corresponding constitutional amendment if approved. The skill MUST NOT silently override anti-goals.

---

**Version**: 1.0.0 | **Ratified**: 2026-05-05 | **Last Amended**: 2026-05-05
