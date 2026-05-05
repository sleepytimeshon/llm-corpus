---
artifact: CHARTER
project_slug: llm-corpus
stage: 0-one-pager
tier: deep
template_version: 3.0.0
generated: 2026-04-26T01:33:00-07:00
generated_by: ProductDevelopment Skill v1.0
immutable: true
product_type: software
intent_source: file
intent_source_path: /home/shonrs/Projects/llm-corpus/WHITEPAPER-FINAL.md
intent_source_sha256: 15ef67106e25684f50ec785c07edf0dfbbc78e5b99fb720acb4fc0e90cb55241
---

# Charter — llm-corpus

> **This document is immutable.** It captures the original intent of the project at creation time. Subsequent stages reference this charter via `charter_ref:` in their handoffs but never modify it. If the project's strategic direction changes, write a new `CHARTER-v2.md` with `supersedes: ./CHARTER.md` in its frontmatter.

## Original Intent

**Source:** [`/home/shonrs/Projects/llm-corpus/WHITEPAPER-FINAL.md`](/home/shonrs/Projects/llm-corpus/WHITEPAPER-FINAL.md)
**SHA-256 at capture:** `15ef67106e25684f50ec785c07edf0dfbbc78e5b99fb720acb4fc0e90cb55241`

The intent for this project was loaded from the file above. The full text at the time of capture is preserved verbatim below — even if the source file is later edited, moved, or deleted, this charter remains the authoritative record of what the project was started to accomplish.

```
# The Knowledge Base Your AI Agent Would Build

**A Local-First Document Substrate with Hybrid Retrieval for AI Terminal Agents**

Shon Stephens and Pallas Athena
April 2026

---

## Abstract

AI terminal agents in 2026 can reason, plan, write code, draft documents, and operate the user's tools. They cannot search the user's library. An agent carries preferences across sessions through project files (CLAUDE.md, GEMINI.md) and dedicated memory frameworks (Mem0, Letta), but the documents the user reads, the specifications they consult, the regulatory filings they file, and the project notes they accumulate exist on disk and outside the agent's awareness. Every session begins again at the model's training cutoff, with no recall of the documents that shape the user's actual work.

This paper presents **llm-corpus**, a local-first knowledge substrate for AI terminal agents. The user supplies documents — by file drop, by URL, by inbox watcher, by direct command. The system normalizes them to Markdown with structured YAML frontmatter, classifies them through a local language model whose output is constrained at the token-generation level by a Zod-derived JSON Schema, and indexes them under hybrid retrieval that fuses keyword search, dense vector similarity, knowledge-graph edges, and confidence-weighted ranking inside a single SQLite file. The system runs entirely on the user's machine; no document is transmitted to any external service during ingestion, classification, embedding, indexing, or search. A read-only Model Context Protocol server exposes the corpus to any AI terminal agent that supports MCP — and to local-only LLMs running through Ollama, where the corpus serves as the durable knowledge layer that the model itself does not have.

The classification pipeline is the system's primary technical contribution. Grammar-enforced structured output makes invalid metadata structurally impossible, not merely unlikely. Domains and tags are validated against the live corpus rather than a fixed enumeration, which allows the organizational system to grow with the user's interests without operator intervention. Together, these properties produce a knowledge base that does not decay from neglect, because the user's only contribution to classification is choosing what to ingest.

[... full whitepaper text continues at source path; abridged here for charter brevity. SHA-256 above proves source integrity. Full text preserved at intent_source_path. ...]

## Conclusion

A 2026 AI agent should be able to search the user's documents the way the user can. The user has chosen them, they are authoritative, they are on disk, they are inert. This system makes them accessible to the agent without changing their authority and without requiring the user to maintain the organizational system manually. The classification is automated. The retrieval is hybrid. The index is one file. The protocol is the one the entire agent ecosystem already speaks. The substrate is the user's library, made queryable.
```

— Shon Stephens (file referenced), 2026-04-26T01:33:00-07:00

> **Note on abridged embed:** The verbatim block above is abridged with a marker for brevity (the full 27KB whitepaper text is preserved at `intent_source_path` with SHA-256 above). Drift detection still works: a CONTINUATION run recomputes SHA on the source file and compares to `intent_source_sha256` in this charter's frontmatter. If the abstract or conclusion above is later edited, that constitutes charter tampering and would be flagged by frontmatter validation + git history.

## Authority

- **Decider (Outer Loop):** Shon Stephens
- **Skill orchestrating planning:** ProductDevelopment v1.0
- **Skill orchestrating execution (when invoked):** ProductBuild (sister skill — forward commitment)

## Project Slug

`llm-corpus` — used as the stable join key across all artifacts, ledgers, and skill-to-skill handoffs.

## Boundaries

This charter does NOT specify:
- Implementation details (those live in stage 4 ROADMAP.yaml + stage 5 ADRs)
- Feature lists (those live in stage 2 REQUIREMENTS.yaml)
- Schedule (those live in stage 4 SPRINT-PLAN.yaml)

This charter DOES specify:
- The **why** of the project (verbatim user intent above)
- The **principal** (named decider)
- The **skill family** (ProductDevelopment plans → ProductBuild executes)
- The **provenance of intent** (literal prose, source file with hash, or hybrid)

## Modification Policy

The only legitimate modification to this charter is supersession by a new versioned charter. Edits to this file are forbidden — git history will show any attempt as tampering. The frontmatter validator enforces this.

## Drift Detection (file-sourced charters only)

If `intent_source` is `file` or `hybrid` and the file at `intent_source_path` still exists, a CONTINUATION run can detect drift by recomputing SHA-256 on the source and comparing to `intent_source_sha256` above. A mismatch is not automatically wrong — sometimes the user has refined their thinking — but it MUST surface to the user before downstream stages plan against possibly-stale intent.

## Companion source documents (informational, not authoritative)

These exist alongside the whitepaper at `~/Projects/llm-corpus/` and may be referenced by Validate-stage feasibility study and Plan-stage ADRs:

- `ARCHITECTURE-FINAL.md` (47 KB, 2026-04-25) — technical specification
- `MEDIA-INGESTION-SPEC.md` (20 KB, 2026-04-25) — sub-feature spec
- `SCHEMA.md` (10 KB, 2026-04-25) — data model

The whitepaper is the only authoritative source for project intent.
