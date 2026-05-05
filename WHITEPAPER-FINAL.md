# The Knowledge Base Your AI Agent Would Build

**A Local-First Document Substrate with Hybrid Retrieval for AI Terminal Agents**

Shon Stephens and Pallas Athena
April 2026

---

## Abstract

AI terminal agents in 2026 can reason, plan, write code, draft documents, and operate the user's tools. They cannot search the user's library. An agent carries preferences across sessions through project files (CLAUDE.md, GEMINI.md) and dedicated memory frameworks (Mem0, Letta), but the documents the user reads, the specifications they consult, the regulatory filings they file, and the project notes they accumulate exist on disk and outside the agent's awareness. Every session begins again at the model's training cutoff, with no recall of the documents that shape the user's actual work.

This paper presents **llm-corpus**, a local-first knowledge substrate for AI terminal agents. The user supplies documents — by file drop, by URL, by inbox watcher, by direct command. The system normalizes them to Markdown with structured YAML frontmatter, classifies them through a local language model whose output is constrained at the token-generation level by a Zod-derived JSON Schema, and indexes them under hybrid retrieval that fuses keyword search, dense vector similarity, knowledge-graph edges, and confidence-weighted ranking inside a single SQLite file. The system runs entirely on the user's machine; no document is transmitted to any external service during ingestion, classification, embedding, indexing, or search. A read-only Model Context Protocol server exposes the corpus to any AI terminal agent that supports MCP — and to local-only LLMs running through Ollama, where the corpus serves as the durable knowledge layer that the model itself does not have.

The classification pipeline is the system's primary technical contribution. Grammar-enforced structured output makes invalid metadata structurally impossible, not merely unlikely. Domains and tags are validated against the live corpus rather than a fixed enumeration, which allows the organizational system to grow with the user's interests without operator intervention. Together, these properties produce a knowledge base that does not decay from neglect, because the user's only contribution to classification is choosing what to ingest.

---

## 1. The Problem

### 1.1 The Knowledge Gap

Modern AI terminal agents have persistence mechanisms. Claude Code maintains CLAUDE.md project files and auto-memory for learned preferences. Gemini CLI offers GEMINI.md files and `/memory` commands. Codex CLI persists session history and supports MCP-based context injection. Dedicated memory frameworks like Mem0 and Letta provide hybrid retrieval over conversation history. These mechanisms solve the *preferences* problem — an agent remembers the user's coding style, deployment targets, preferred frameworks, and conversational habits. They do not solve the *knowledge* problem.

A knowledge worker accumulates reference material continuously: research papers, technical specifications, government forms, regulatory filings, transcripts, books, project notes. The material is stored on a filesystem, in a notes app, in a downloads folder, in browser bookmarks. It is, by every meaningful definition, *available* to the user. It is not available to the agent. When the user asks the agent a question that their own library would answer, the agent answers from its training cutoff or hallucinates. The agent does not say *"I will check what you read last week"* because it cannot.

The gap is not that agents lack access to information; the open web is information. The gap is that agents lack access to **the user's curated subset of information** — the small, opinionated set of documents the user has chosen to keep. This subset is what gives the user authority on a topic. An agent denied access to it operates with strictly less context than the user it serves.

### 1.2 The Decay of Manual Classification

Multi-dimensional document organization is not a new idea. Ranganathan's faceted classification (1933) decoupled subject organization from physical shelving. Modern personal-knowledge tools — Obsidian, Notion, Logseq, Roam — implement variations of the same principle through tags, links, properties, and graph views.

Two failure modes recur across every implementation. **Manual tagging decays.** Users tag diligently for the first fifty documents and abandon the practice by document two hundred. The classification system rots not from bad design but from the per-document cost of human labeling. **Human-first interfaces resist programmatic access.** A vault full of richly tagged documents is not, by virtue of its tags, a system an AI agent can query — there is no machine interface to invoke, no structured response to parse, no ranked retrieval API. The graph view is for human eyes.

The system this paper presents addresses both failures by inverting their assumptions. Classification runs at ingestion through a local language model with grammar-enforced output, at zero marginal cost per document. The organizational system cannot decay from neglect because the user's only contribution to classification is selecting what to ingest. Retrieval is exposed through structured, programmatic interfaces, callable directly by any AI agent that speaks the Model Context Protocol or executes a shell command.

---

## 2. Background

### 2.1 The Agent Ecosystem

Three AI terminal agents dominate in 2026. **Claude Code** (Anthropic) provides project-scoped memory via CLAUDE.md, an extensible skill system, hooks, and native MCP support. **Gemini CLI** (Google) supports MCP, session persistence, and a built-in tool registry. **Codex CLI** (OpenAI) sandboxes execution and supports MCP through stdio transport. All three execute shell commands and parse structured output. Any tool that returns JSON is natively accessible to all three without platform-specific adapters.

A second class of agents matters for this work: local-only LLMs running through Ollama, llama.cpp, or MLX. These models execute entirely on the user's machine, with no cloud fallback for retrieval, no hosted memory service, and no attached-context UX. For a user whose primary reasoning engine is a local LLM, the corpus is not a complementary knowledge layer — it is *the* knowledge layer. The model itself contains no documents; the corpus contains them. The system is designed to serve both classes of agent identically.

### 2.2 The Model Context Protocol

Anthropic released MCP in November 2024 as an open standard for connecting AI applications to external data and tools. By mid-2025 it had been adopted by OpenAI (March 26, 2025), Google (April 9, 2025), and Microsoft (May 19, 2025). All three terminal agents support MCP servers via stdio transport. The protocol is now governed by the Linux Foundation's Agentic AI Foundation. The 2025-11-25 specification supports five primitives — tools, resources, prompts, sampling, and elicitation — the first three of which are the ones this system uses.

MCP is the integration surface that makes agent-native tooling tractable in 2026. A knowledge base that exposes an MCP interface is instantly accessible to every major AI agent through a single server implementation, with no per-platform adapter layer.

### 2.3 Related Approaches

**Cloud-hosted RAG.** Google NotebookLM offers source-grounded retrieval-augmented generation against uploaded documents, using Gemini's long-context window. The trade-off is that documents must leave the user's machine. For sensitive material — financial records, medical files, legal documents, proprietary specifications — this is impermissible regardless of the cloud provider's controls.

**Personal knowledge management with embeddings.** Obsidian's Smart Connections plugin provides local semantic search over Markdown vaults via Ollama embeddings. It shares this work's design values (local, Markdown, privacy) but is built for human navigation; programmatic agent access requires user-supplied glue.

**Embedded retrieval libraries.** txtai, ChromaDB, LanceDB, FAISS, and `sqlite-vec` (Garcia, 2024) bring hybrid and vector retrieval into single-process applications with no external service. These provide the substrate for retrieval but not a finished knowledge base.

**LLM-as-compiler wikis.** Karpathy (April 2026) proposed a stateful LLM-maintained Markdown wiki where the model acts as a compiler, resolving raw sources into wiki pages and reconciling contradictions. This work shares the inspiration that plain text with structured metadata serves LLMs better than embedding pipelines at personal scale, and adopts a different stance on the LLM's role: in this system the LLM is a classifier and a retrieval target, not a compiler. The user remains the authority on what enters the corpus.

**Conversation-memory frameworks.** Mem0, Letta, and Claude's auto-memory address the *memory* problem — what the user said, what the agent did, what the user prefers. They are not document stores, and they are not designed to be. The boundary between knowledge and memory is examined explicitly in §4.

---

## 3. The System

### 3.1 Design Principles

The system rests on five principles. Each is an active choice.

**P1. Store documents at full fidelity.** Documents are Markdown with YAML frontmatter. Plain text and structured metadata together survive every change in tooling, runtime, and model. The store is grep-able, hand-editable, and inspectable in any text editor on any platform. The user can version their library with `git`. No proprietary format, no embedded binary, no lock-in.

**P2. Classify automatically.** Manual tagging decays; automated classification at zero marginal cost does not. The classifier's output schema is enforced at the token-generation level, and its vocabulary grows with the corpus rather than being fixed at the system's birth.

**P3. Retrieve through one hybrid surface.** A single retrieval API merges keyword search, dense vector similarity, knowledge-graph edges, and confidence-weighted ranking. Callers see ranked results; the merging is internal. The retrieval implementation may evolve without breaking integrations.

**P4. Stay local.** Ingestion, classification, embedding, indexing, and search execute entirely on the user's machine. No document leaves the machine during processing. This matters when documents are sensitive, and it matters structurally when the user's primary reasoning engine is a local LLM that has no cloud fallback for knowledge.

**P5. Grow without operator intervention.** The dynamic taxonomy admits new domains and tags as content arrives. The autonomous pipeline ingests dropped files without human action. The system requires no per-document maintenance after the user supplies documents.

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

The system is layered: agents consume the interfaces, the interfaces call into a core library, the core library calls adapters, and adapters speak to the local store and external processes. The arrows are unidirectional and the dependencies flow downward only. Concrete URIs, tool signatures, schema fields, file-system layout, and per-adapter contracts are specified in the companion architecture document.

### 3.3 Classification

Classification turns an unstructured document into a structured record at ingest time. The pipeline is the system's primary technical contribution. It uses a local language model whose output is constrained by a JSON Schema compiled into the model's grammar:

```
Zod schema → JSON Schema → grammar enforcement → guaranteed valid JSON
                                              → typed, validated result
```

This is not prompt engineering. The grammar engine constrains token generation at the logit level: the model structurally cannot produce JSON that violates the schema. Invalid field values, missing required fields, and malformed structures are impossible.

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

Three facet enumerations are fixed at the system level (`source_type`, `facet_type`, `facet_stage`). Two are dynamic: `facet_domain` and `tags` are open vocabularies, validated at classification time against the corpus's own active terms rather than a hardcoded list. When the classifier finds no existing domain a document fits, it proposes a new one, and the proposed domain enters a registry where it earns adoption by reaching a documented threshold of corpus presence. The taxonomy grows with the user's interests, and the user is never the one applying labels.

Processing depth varies by source type. Forms and reference documents are classified only — the source content is the knowledge. Notes and transcripts receive light cleanup and summarization. Articles, videos, podcasts, and books receive full extraction of arguments, findings, and reusable ideas into the document body. Research papers receive structured-summary extraction. Depth is a property of the source type, not a per-document decision.

### 3.4 Hybrid Retrieval

Retrieval is how the agent becomes aware of stored knowledge. The system combines four complementary methods behind a single API.

**Keyword search** handles exact-terminology queries — *"Form 1040-ES"*, *"systemd path unit"*. It is fast, explainable, and requires no embedding model. Weighting prioritizes the metadata fields the classification pipeline produces (summary, tags, topic) over body text, on the assumption that the classifier-generated metadata is the highest-signal representation of the document.

**Dense vector search** handles conceptual queries where terms do not overlap — a query for *"estimated tax payments"* surfaces documents about *"quarterly withholding requirements"* even when those exact terms never appear together. Document embeddings are produced at ingest by a local embedding model.

**Reciprocal rank fusion** merges keyword and vector result sets without score normalization (Cormack, Clarke, & Buettcher, 2009). The agent receives one ranked list; the merging is internal.

**Knowledge-graph edges** capture cross-document relationships beyond similarity. Edges are computed from tag overlap, summary-embedding cosine similarity, and explicit `related` arrays in the frontmatter. The agent can traverse from a known document to its connected documents — *"what does this reference?"* — rather than only retrieving by query.

**Confidence-weighted ranking** adjusts scores by per-source-type priors. A peer-reviewed research paper outranks a blog post for the same query at equal similarity. A reference document is preferred over a transcript when both match. Recency boosts time-sensitive material; staleness penalties apply to documents whose source content is known to expire. Confidence weighting is computed entirely from existing schema fields.

Retrieval falls through tiers when the primary method returns sparse results. Hybrid retrieval is the default tier; keyword-only, body grep over the catalog, and full-text grep over documents are progressively cheaper coverage paths.

### 3.5 The Agent Surface

The corpus exposes its read surface to integrating agents through a Model Context Protocol server. The MCP server is read-only by design: mutations to the corpus — adding documents, removing documents, restoring documents from trash — are the user's responsibility, executed through the corpus CLI directly or through user-installed skills that compose CLI operations into ergonomic workflows. The boundary is intentional. The corpus is the user's library; the user authorizes what enters and leaves it.

The MCP server uses three of the protocol's primitives. **Tools** are agent-invoked read operations. **Resources** are URI-addressable content the agent reads on demand or auto-loads at session start. **Prompts** are server-supplied templates that distribute the corpus's usage protocol cross-agent — answering, on the substrate side, what would otherwise require per-agent configuration: how an agent knows when to use the corpus and how it uses the results. Any MCP-aware agent that loads the prompts gets the protocol.

Write operations live on the corpus CLI. The CLI is what the user invokes directly when working outside an agent session, what the autonomous pipeline invokes internally for inbox processing, and what skills shell out to for write workflows. Documents removed from the corpus enter a soft-delete state with a configurable time-to-live; the user can restore deleted documents at any point before TTL expiration, or escalate to permanent removal explicitly.

Skills are agent-environment workflow compositions installed by the user. Skills are a Claude Code capability and exist on other compatible agent platforms with similar composition shape. The corpus skill provides higher-abstraction operations the user habitually wants — ingesting a reading list of URLs, pruning documents older than two years from a domain, recapping recent ingests, composing a citation set for a writing project. A skill calls the corpus CLI for write operations and reads the corpus through the MCP server. Skills are not required for the corpus to be useful through MCP; they are an ergonomic layer above the substrate's protocol baseline.

### 3.6 Privacy and Local Operation

The system enforces a strict local boundary. Ingestion, classification, embedding, indexing, and search execute on the user's machine. No document is transmitted to any external service during processing.

When documents are retrieved by a cloud-hosted AI agent — Claude Code, Gemini CLI, Codex CLI — the retrieved content enters that agent's context window and is transmitted to the provider's API. This is an inherent property of cloud-hosted LLMs and is not a property of this system. The distinction from cloud RAG architectures is structural: cloud RAG requires the full corpus to live on a third-party service as a precondition for any retrieval; this system retains the corpus locally and transmits only the documents that match a specific query, only at the moment of that query.

For users whose primary reasoning engine is a local LLM, the privacy boundary is absolute. The corpus is the model's knowledge layer; the query is local; the documents never leave the machine at any point in the workflow. This is the use case for which local-first is not a preference but a design requirement.

### 3.7 The Autonomous Pipeline

A file-system watcher monitors an inbox directory. When files arrive, a validation gate checks extension, MIME type, size, and filename safety. Validated files enter a queue and are processed through the full pipeline — extraction, classification, embedding, indexing — without human intervention. The user drops files in; the corpus assimilates them.

Every pipeline stage is idempotent, atomic, telemetry-emitting, and resumable. A process killed mid-run leaves the corpus in a recoverable state; the next run resumes from the last successfully-completed stage. Failures route to a dedicated lane with structured diagnostics; no document silently disappears. The user can inspect the failure lane, correct the input, and replay.

---

## 4. Discussion: Knowledge versus Memory

This system draws a deliberate line between **knowledge** and **memory**.

**Knowledge** is the body of documents the user has chosen to keep. Articles read and saved, specifications referenced, regulatory filings filed, books worked through, project notes accumulated, transcripts retained. Knowledge is authoritative because the user selected it. Its value lies in being the actual source material — not a derivative of it.

**Memory** is the record of an agent's operation alongside the user. Conversation history, learned preferences, behavioral observations, retrieved-and-summarized state. Memory is generated by the agent in service of continuity. Mem0, Letta, and Claude's auto-memory are well-suited to this purpose.

The two are different objects with different lifecycles. Knowledge is curated once at ingestion and remains stable; the system normalizes and summarizes the source material at ingest time, but those transformations remain part of the user-curated document, not derivative artifacts on top of it. Memory is produced continuously during interaction and evolves. Knowledge is authoritative; memory is contextual. A document the user filed last year is still a document the user filed; a memory of a conversation last week is a derivative of that conversation, not the conversation itself.

This system is a knowledge store. It does not record agent observations, conversational state, or model-generated synthesis. The boundary is a definitional choice that keeps the corpus what it is — the user's documents — and lets memory frameworks be what they are. A complete personal-AI architecture has both; this paper specifies one.

---

## 5. Future Work

**Formal retrieval evaluation.** A benchmark of fifty to one hundred queries with human-judged relevance, comparing keyword-only, vector-only, hybrid, and hybrid-with-graph-and-confidence-weighting retrieval on standard information-retrieval metrics. The benchmark gates future ranking changes against measured impact rather than intuition.

**Body-chunk-level embeddings.** Document-level embeddings work at personal-corpus scale. As corpora grow into the tens of thousands of documents and per-document length increases, paragraph-level chunking with positional embeddings becomes the natural next step. The schema is already designed to admit this evolution without breaking existing indices.

---

## 6. Conclusion

A 2026 AI agent should be able to search the user's documents the way the user can. The user has chosen them, they are authoritative, they are on disk, they are inert. This system makes them accessible to the agent without changing their authority and without requiring the user to maintain the organizational system manually. The classification is automated. The retrieval is hybrid. The index is one file. The protocol is the one the entire agent ecosystem already speaks. The substrate is the user's library, made queryable.

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
