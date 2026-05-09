# llm-corpus: A Local-First Document Substrate with Hybrid Retrieval for AI Terminal Agents

Shon Stephens and Pallas Athena
April 2026

---

## Abstract

AI terminal agents in 2026 can reason, plan, write code, draft documents, and operate the user's tools, but they cannot search the user's library. An agent carries preferences across sessions through project files (CLAUDE.md, GEMINI.md) and dedicated memory frameworks such as Mem0 and Letta, while the documents the user reads, the specifications they consult, the regulatory filings they file, and the project notes they accumulate exist on disk and outside the agent's awareness. Each session begins again at the model's training cutoff, with no recall of the documents that shape the user's actual work.

This paper presents *llm-corpus*, a local-first knowledge substrate for AI terminal agents. Documents are supplied by file drop, by URL, by inbox watcher, or by direct command. The system normalizes them to Markdown with structured YAML frontmatter, classifies them through a local language model whose output is constrained at the token-generation level by a Zod-derived JSON Schema, and indexes them under hybrid retrieval that fuses keyword search, dense vector similarity, knowledge-graph edges, and confidence-weighted ranking inside a single SQLite file. The system runs entirely on the user's machine; no document is transmitted to any external service during ingestion, classification, embedding, indexing, or search. A read-only Model Context Protocol server exposes the corpus to any AI terminal agent that supports MCP, including local-only LLMs running through Ollama, where the corpus serves as the durable knowledge layer that the model itself does not provide.

The classification pipeline is the system's primary technical contribution. Grammar-enforced structured output makes invalid metadata structurally impossible rather than merely unlikely. Domains and tags are validated against the live corpus rather than a fixed enumeration, allowing the organizational system to grow with the user's interests without operator intervention. Together, these properties produce a knowledge base that does not decay from neglect, because the user's only contribution to classification is choosing what to ingest.

---

## 1. The Problem

### 1.1 The Knowledge Gap

Modern AI terminal agents have persistence mechanisms. Claude Code maintains CLAUDE.md project files and auto-memory for learned preferences. Gemini CLI offers GEMINI.md files and `/memory` commands. Codex CLI persists session history and supports MCP-based context injection. Dedicated memory frameworks such as Mem0 and Letta provide hybrid retrieval over conversation history. These mechanisms address the *preferences* problem: an agent retains the user's coding style, deployment targets, preferred frameworks, and conversational habits. They do not address the *knowledge* problem.

A knowledge worker accumulates reference material continuously: research papers, technical specifications, government forms, regulatory filings, transcripts, books, and project notes. The material is stored on a filesystem, in a notes app, in a downloads folder, and in browser bookmarks. By every meaningful definition the material is available to the user, but it is not available to the agent. When the user asks the agent a question that the user's own library would answer, the agent answers from its training cutoff or hallucinates, because no mechanism exists for the agent to consult last week's reading.

The gap concerns the user's curated subset of information rather than information in general. The open web is information; the corpus is the small, opinionated set of documents the user has chosen to keep. That subset is what gives the user authority on a topic, and an agent denied access to it operates with strictly less context than the user it serves.

### 1.2 The Decay of Manual Classification

Multi-dimensional document organization is not a new idea. Ranganathan's faceted classification (1933) decoupled subject organization from physical shelving. Modern personal-knowledge tools — Obsidian, Notion, Logseq, Roam — implement variations of the same principle through tags, links, properties, and graph views.

Two failure modes recur across implementations. The first is decay of manual tagging: users tag diligently for the first fifty documents and abandon the practice by document two hundred, and the classification system degrades under the per-document cost of human labeling rather than under any defect of design. The second is limited programmatic accessibility: a vault of richly tagged documents is not, by virtue of its tags, a system an AI agent can query, because no machine interface, structured response format, or ranked retrieval API is exposed. The graph view is designed for human navigation.

The system presented here addresses both failure modes by inverting their assumptions. Classification runs at ingestion through a local language model with grammar-enforced output, at zero marginal cost per document, so the organizational system cannot decay from neglect; the user's only contribution to classification is selecting which documents to ingest. Retrieval is exposed through structured, programmatic interfaces, callable directly by any AI agent that speaks the Model Context Protocol or executes a shell command.

---

## 2. Background

### 2.1 The Agent Ecosystem

Three AI terminal agents are in widespread use in 2026. Claude Code (Anthropic) provides project-scoped memory via CLAUDE.md, an extensible skill system, hooks, and native MCP support. Gemini CLI (Google) supports MCP, session persistence, and a built-in tool registry. Codex CLI (OpenAI) sandboxes execution and supports MCP through stdio transport. All three execute shell commands and parse structured output, and any tool that returns JSON is natively accessible to all three without platform-specific adapters.

A second class of agents matters for this work: local-only LLMs running through Ollama, llama.cpp, or MLX. These models execute entirely on the user's machine, with no cloud fallback for retrieval, no hosted memory service, and no attached-context UX. For a user whose primary reasoning engine is a local LLM, the corpus functions as the knowledge layer rather than a complementary one, because the model itself contains no documents and the corpus does. The system is designed to serve both classes of agent identically.

### 2.2 The Model Context Protocol

Anthropic released MCP in November 2024 as an open standard for connecting AI applications to external data and tools. By mid-2025 it had been adopted by OpenAI (March 26, 2025), Google (April 9, 2025), and Microsoft (May 19, 2025). All three terminal agents support MCP servers via stdio transport. The protocol is now governed by the Linux Foundation's Agentic AI Foundation. The 2025-11-25 specification supports five primitives — tools, resources, prompts, sampling, and elicitation — the first three of which the system uses.

MCP is the integration surface that makes agent-native tooling tractable in 2026. A knowledge base that exposes an MCP interface is accessible to every major AI agent through a single server implementation, with no per-platform adapter layer.

### 2.3 Related Approaches

Cloud-hosted retrieval-augmented generation services such as Google NotebookLM offer source-grounded retrieval against uploaded documents using long-context models. The trade-off is that documents must leave the user's machine, which is impermissible for sensitive material — financial records, medical files, legal documents, proprietary specifications — regardless of the cloud provider's controls.

Personal knowledge management tooling with embeddings, exemplified by Obsidian's Smart Connections plugin, provides local semantic search over Markdown vaults via Ollama embeddings. It shares the present work's design values of locality, Markdown, and privacy, but is built for human navigation, and programmatic agent access requires user-supplied glue.

Embedded retrieval libraries — txtai, ChromaDB, LanceDB, FAISS, and `sqlite-vec` (Garcia, 2024) — bring hybrid and vector retrieval into single-process applications without an external service. They provide the substrate for retrieval rather than a finished knowledge base.

Karpathy (April 2026) proposed a stateful LLM-maintained Markdown wiki in which the model acts as a compiler, resolving raw sources into wiki pages and reconciling contradictions. The present work shares the inspiration that plain text with structured metadata serves LLMs better than embedding pipelines at personal scale, while adopting a different stance on the LLM's role: here the LLM is a classifier and a retrieval target rather than a compiler, and the user remains the authority on what enters the corpus.

Conversation-memory frameworks such as Mem0, Letta, and Claude's auto-memory address the memory problem of what the user said, what the agent did, and what the user prefers. They are not document stores and are not designed to be. The boundary between knowledge and memory is examined explicitly in §4.

---

## 3. The System

### 3.1 Design Principles

The system rests on five principles, each adopted in preference to a more conventional alternative.

1. P1 — Documents are stored at full fidelity as Markdown with YAML frontmatter. Plain text and structured metadata together survive changes in tooling, runtime, and model. The store is grep-able, hand-editable, and inspectable in any text editor on any platform. The user can version the library with `git`, and no proprietary format, embedded binary, or lock-in is introduced.
2. P2 — Classification runs automatically. Manual tagging decays, while automated classification at zero marginal cost does not. The classifier's output schema is enforced at the token-generation level, and its vocabulary grows with the corpus rather than being fixed at the system's birth.
3. P3 — Retrieval is exposed through one hybrid surface. A single retrieval API merges keyword search, dense vector similarity, knowledge-graph edges, and confidence-weighted ranking. Callers receive ranked results, and the merging is internal so that the retrieval implementation may evolve without breaking integrations.
4. P4 — Operation stays local. Ingestion, classification, embedding, indexing, and search execute entirely on the user's machine. No document leaves the machine during processing. This property matters when documents are sensitive, and it matters structurally when the user's primary reasoning engine is a local LLM that has no cloud fallback for knowledge.
5. P5 — The system grows without operator intervention. The dynamic taxonomy admits new domains and tags as content arrives, and the autonomous pipeline ingests dropped files without human action. No per-document maintenance is required after the user supplies documents.

### 3.2 Architecture Overview

```
                ┌─────────────────────────────────────────────────────────┐
                │                CONSUMERS (any AI agent)                 │
                │   Claude Code · Gemini CLI · Codex CLI · local LLMs     │
                └─────────────────────────────┬───────────────────────────┘
                                              │
                ┌─────────────────────────────▼───────────────────────────┐
                │                    INTERFACES                           │
                │   read-only MCP server   ·   write-side CLI binary      │
                └─────────────────────────────┬───────────────────────────┘
                                              │
                ┌─────────────────────────────▼───────────────────────────┐
                │                       CORE                              │
                │   pipeline · classification · retrieval · schema ·      │
                │   reconciler · janitor · telemetry                      │
                └──────────┬──────────────────────────────────┬───────────┘
                           │                                  │
        ┌──────────────────▼──────────────────┐  ┌────────────▼──────────┐
        │   ADAPTERS                          │  │   STORE (XDG paths)   │
        │   storage · inference · embedding · │  │   docs · inbox ·      │
        │   index · extractor                 │  │   index · telemetry   │
        └─────────────────────────────────────┘  └───────────────────────┘
```

The system is layered. Agents consume the interfaces, the interfaces call into a core library, the core library calls adapters, and adapters speak to the local store and external processes. The arrows are unidirectional and the dependencies flow downward only. Concrete URIs, tool signatures, schema fields, file-system layout, and per-adapter contracts are specified in the companion architecture document.

### 3.3 Classification

Classification turns an unstructured document into a structured record at ingest time, and the pipeline is the system's primary technical contribution. A local language model produces output constrained by a JSON Schema compiled into the model's grammar:

```
Zod schema → JSON Schema → grammar enforcement → guaranteed valid JSON
                                              → typed, validated result
```

The grammar engine constrains token generation at the logit level, so the model cannot produce JSON that violates the schema. Invalid field values, missing required fields, and malformed structures are structurally impossible rather than merely improbable, which distinguishes this approach from prompt-only schema instructions.

Every document carries structured frontmatter that records its identity, source, processing state, and faceted classification. A representative example:

```yaml
---
id: "doc-c8cf6ea2"
title: "Quarterly Infrastructure Review: Q1 2026"
source: "https://internal.example.com/q1-review"
source_type: notes
date_ingested: "2026-04-21"
facet_domain: agent-systems
facet_topic: infrastructure-planning
facet_type: analysis
facet_stage: synthesized
tags: [infrastructure, quarterly-review, capacity-planning]
summary: "Q1 review identifies three infrastructure bottlenecks..."
---
```

Three facet enumerations are fixed at the system level (`source_type`, `facet_type`, `facet_stage`). Two are dynamic: `facet_domain` and `tags` are open vocabularies, validated at classification time against the corpus's own active terms rather than a hardcoded list. When the classifier finds no existing domain that fits a document, it proposes a new one, and the proposed domain enters a registry where it earns adoption by reaching a documented threshold of corpus presence. The taxonomy grows with the user's interests, and the user does not apply labels.

Processing depth varies by source type. Forms and reference documents are classified only, since the source content is the knowledge. Notes and transcripts receive light cleanup and summarization. Articles, videos, podcasts, and books receive full extraction of arguments, findings, and reusable ideas into the document body. Research papers receive structured-summary extraction. Depth is a property of the source type rather than a per-document decision.

### 3.4 Hybrid Retrieval

The retrieval layer combines four complementary methods behind a single API.

Keyword search handles exact-terminology queries such as "Form 1040-ES" or "systemd path unit". It is fast, explainable, and requires no embedding model. Weighting prioritizes the metadata fields produced by the classification pipeline (summary, tags, topic) over body text, on the assumption that classifier-generated metadata is the highest-signal representation of the document.

Dense vector search handles conceptual queries where surface terms do not overlap. A query for "estimated tax payments" surfaces documents about "quarterly withholding requirements" even when those exact terms never appear together. Document embeddings are produced at ingest by a local embedding model.

Reciprocal rank fusion merges keyword and vector result sets without score normalization (Cormack, Clarke, & Buettcher, 2009). The agent receives one ranked list, and the merging is internal.

Knowledge-graph edges capture cross-document relationships beyond similarity. Edges are computed from tag overlap, summary-embedding cosine similarity, and explicit `related` arrays in the frontmatter. The agent can traverse from a known document to its connected documents rather than retrieve only by query.

Confidence-weighted ranking adjusts scores by per-source-type priors. A peer-reviewed research paper outranks a blog post for the same query at equal similarity, and a reference document is preferred over a transcript when both match. Recency boosts time-sensitive material, and staleness penalties apply to documents whose source content is known to expire. Confidence weighting is computed entirely from existing schema fields.

Retrieval falls through tiers when the primary method returns sparse results. Hybrid retrieval is the default tier; keyword-only, body grep over the catalog, and full-text grep over documents are progressively cheaper coverage paths.

### 3.5 The Agent Surface

The corpus exposes its read surface to integrating agents through a Model Context Protocol server. The MCP server is read-only by design; mutations to the corpus — adding documents, removing documents, restoring documents from trash — are the user's responsibility, executed through the corpus CLI directly or through user-installed skills that compose CLI operations into ergonomic workflows. The boundary is intentional: the corpus is the user's library, and the user authorizes what enters and leaves it.

The MCP server uses three of the protocol's primitives. Tools are agent-invoked read operations. Resources are URI-addressable content the agent reads on demand or auto-loads at session start. Prompts are server-supplied templates that distribute the corpus's usage protocol cross-agent, answering on the substrate side what would otherwise require per-agent configuration: how an agent recognizes when to use the corpus and how it interprets the results. Any MCP-aware agent that loads the prompts adopts the protocol without further configuration.

Write operations live on the corpus CLI. The CLI is invoked by the user directly when working outside an agent session, by the autonomous pipeline internally for inbox processing, and by skills that shell out for write workflows. Documents removed from the corpus enter a soft-delete state with a configurable time-to-live, and the user can restore deleted documents at any point before TTL expiration or escalate to permanent removal explicitly.

Skills are agent-environment workflow compositions installed by the user. Skills are a Claude Code capability and exist on other compatible agent platforms with similar composition shape. The corpus skill provides higher-abstraction operations the user habitually wants, such as ingesting a reading list of URLs, pruning documents older than two years from a domain, recapping recent ingests, or composing a citation set for a writing project. A skill calls the corpus CLI for write operations and reads the corpus through the MCP server. Skills are not required for the corpus to be useful through MCP; they are an ergonomic layer above the substrate's protocol baseline.

### 3.6 Privacy and Local Operation

The system enforces a strict local boundary. Ingestion, classification, embedding, indexing, and search execute on the user's machine, and no document is transmitted to any external service during processing.

When documents are retrieved by a cloud-hosted AI agent — Claude Code, Gemini CLI, Codex CLI — the retrieved content enters that agent's context window and is transmitted to the provider's API. This transmission is an inherent property of cloud-hosted LLMs and is independent of the corpus design. The distinction from cloud RAG architectures is structural: cloud RAG requires the full corpus to live on a third-party service as a precondition for any retrieval, while this system retains the corpus locally and transmits only the documents that match a specific query, only at the moment of that query.

For users whose primary reasoning engine is a local LLM, the privacy boundary is absolute. The corpus is the model's knowledge layer, the query is local, and the documents do not leave the machine at any point in the workflow. This is the use case for which local-first operation is a design requirement rather than a preference.

### 3.7 The Autonomous Pipeline

A file-system watcher monitors an inbox directory. When files arrive, a validation gate checks extension, MIME type, size, and filename safety. Validated files enter a queue and are processed through the full pipeline — extraction, classification, embedding, indexing — without human intervention. Files placed in the inbox are absorbed into the corpus by the pipeline.

Every pipeline stage is idempotent, atomic, telemetry-emitting, and resumable. A process killed mid-run leaves the corpus in a recoverable state, and the next run resumes from the last successfully completed stage. Failures route to a dedicated lane with structured diagnostics so that no document silently disappears. The user can inspect the failure lane, correct the input, and replay.

---

## 4. Discussion: Knowledge versus Memory

This system draws a deliberate line between knowledge and memory.

Knowledge is the body of documents the user has chosen to keep: articles read and saved, specifications referenced, regulatory filings filed, books worked through, project notes accumulated, and transcripts retained. Knowledge is authoritative because the user selected it, and its value lies in being the actual source material rather than a derivative of it.

Memory is the record of an agent's operation alongside the user: conversation history, learned preferences, behavioral observations, and retrieved-and-summarized state. Memory is generated by the agent in service of continuity, and Mem0, Letta, and Claude's auto-memory are well-suited to this purpose.

The two are different objects with different lifecycles. Knowledge is curated once at ingestion and remains stable; the system normalizes and summarizes the source material at ingest time, and those transformations remain part of the user-curated document rather than derivative artifacts on top of it. Memory is produced continuously during interaction and evolves. Knowledge is authoritative; memory is contextual. A document the user filed last year is still that document, while a memory of a conversation last week is a derivative of that conversation rather than the conversation itself.

This system is a knowledge store. It does not record agent observations, conversational state, or model-generated synthesis. The boundary is a definitional choice that keeps the corpus what it is — the user's documents — and lets memory frameworks be what they are. A complete personal-AI architecture has both; this paper specifies one.

---

## 5. Future Work

A formal retrieval evaluation is the immediate next step. A benchmark of fifty to one hundred queries with human-judged relevance, comparing keyword-only, vector-only, hybrid, and hybrid-with-graph-and-confidence-weighting retrieval on standard information-retrieval metrics, would gate future ranking changes against measured impact rather than intuition.

Body-chunk-level embeddings are a longer-term direction. Document-level embeddings work at personal-corpus scale, but as corpora grow into the tens of thousands of documents and per-document length increases, paragraph-level chunking with positional embeddings becomes the natural next step. The schema is already designed to admit this evolution without breaking existing indices.

---

## 6. Conclusion

A 2026 AI agent should be able to search the user's documents the way the user can. The documents have been chosen by the user, they are authoritative, they reside on disk, and they are otherwise inert. This system makes them accessible to the agent without altering their authority and without requiring manual maintenance of the organizational structure: classification runs automatically through a grammar-constrained local model, retrieval combines keyword, vector, graph, and confidence-weighted ranking behind a single API, the index is a single SQLite file, and the integration surface is the Model Context Protocol that the major AI terminal agents already implement. The substrate makes the user's library queryable while preserving the user's authority over what it contains.

---

## References

1. Anthropic. *Introducing the Model Context Protocol.* November 25, 2024.
2. Asai, A., et al. *Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection.* ICLR 2024.
3. Barnett, S., et al. *Seven Failure Points When Engineering a Retrieval-Augmented Generation System.* arXiv:2401.05856, 2024.
4. Cormack, G. V., Clarke, C. L. A., and Buettcher, S. *Reciprocal rank fusion outperforms Condorcet and individual rank learning methods.* SIGIR, 2009.
5. Garcia, A. *sqlite-vec: A Vector Search SQLite Extension That Runs Anywhere.* GitHub, 2024.
6. Hong, K., Troynikov, A., and Huber, J. *Context Rot: How Increasing Input Tokens Impacts LLM Performance.* Chroma Research, July 2025.
7. Karpathy, A. *LLM Wiki.* GitHub Gist, April 2026.
8. Model Context Protocol Specification, March 2025 (revised November 2025).
9. Ranganathan, S. R. *Colon Classification.* Madras Library Association, 1933.
10. SQLite FTS5 Extension. sqlite.org/fts5.html.
11. Thakur, N., et al. *BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models.* NeurIPS, 2021.
12. Xu, P., et al. *Retrieval Meets Long Context Large Language Models.* arXiv:2310.03025, 2023.
13. Zhu, D., et al. *StructEval: Benchmarking LLMs' Capabilities to Generate Structural Outputs.* arXiv:2505.20139, 2025.

---

*Companion document: `ARCHITECTURE-FINAL.md` (technical specification).*
