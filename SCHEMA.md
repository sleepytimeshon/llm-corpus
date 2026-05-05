# Corpus — Frontmatter Schema

**Version:** 1.0
**Date:** 2026-04-18
**Authority:** RFC 0001 — The Faceted Plain-Text Lake Architecture

This document defines the data contract for all documents in the Corpus knowledge base. Every markdown file in `/data/library/docs/` MUST include a YAML frontmatter block conforming to this schema.

---

## Frontmatter Template

```yaml
---
id: "doc-a1b2c3d4"
title: "Document Title"
source: "https://example.com/article"
source_type: article
date_ingested: "2026-04-18"
facet_domain: agent-systems
facet_topic: memory-architecture
facet_type: tutorial
facet_stage: synthesized
tags: [agent-memory, context-window, retrieval-tools]
related: []
summary: "One-sentence insight that lets an LLM decide relevance without reading the body"
---
```

---

## Field Definitions

### Identity Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `id` | YES | `string` | Stable unique identifier. Format: `doc-{8 lowercase hex chars}`. Generated once, never changed. Used for cross-referencing in `related` arrays and future graph edges. |
| `title` | YES | `string` | Document title. Preserve the original article/paper title when available. |
| `source` | YES | `string` | Original URL, file path, or bibliographic citation. The provenance record. |
| `source_type` | YES | `enum` | What the original artifact was before normalization to markdown. |
| `date_ingested` | YES | `date` | ISO 8601 date when the document was added to Corpus. Format: `YYYY-MM-DD`. |

### Facet Fields (PMEST-Derived)

All facet fields are **flat single-line YAML**. No nesting. This is a hard constraint — nested YAML breaks single-line grep, which is the primary retrieval mechanism for the LLM consumer.

| Field | Required | Type | PMEST | Description |
|-------|----------|------|-------|-------------|
| `facet_domain` | YES | `string` | Personality | Primary subject area. Use controlled vocabulary below. |
| `facet_topic` | YES | `string` | Personality | Specific topic within the domain. Kebab-case, descriptive. |
| `facet_type` | YES | `enum` | Matter | Structural kind of document. |
| `facet_stage` | YES | `enum` | Energy | Processing/transformation state. |

**Why PMEST:** Ranganathan's faceted classification provides independent dimensions that avoid the Physical Shelf Limitation. Each facet is a separate lens on the document, not a hierarchical category.

### Discovery Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `tags` | YES | `array` | 3-10 grep-able keywords. Use controlled vocabulary where available, extend naturally for new concepts. Lowercase, kebab-case. |
| `related` | NO | `array` | Document IDs (`doc-{8hex}`) of related artifacts. Placeholder for future loci_adjacent graph edges. Default: `[]`. |
| `summary` | YES | `string` | **THE critical retrieval field.** One sentence (15-25 words) capturing the document's core insight. An LLM decides relevance from this line alone without reading the body. Must be specific and opinionated, not generic. |

---

## Enumerations

### `source_type` — What the Original Artifact Was

| Value | Description |
|-------|-------------|
| `article` | Web article, blog post, news piece |
| `research-paper` | Academic paper, arXiv, conference paper |
| `manual` | Technical manual, documentation, guide |
| `form` | Government form, application, official document |
| `video` | YouTube video, recorded talk, webinar |
| `podcast` | Podcast episode, audio interview |
| `book` | Book, book chapter, ebook |
| `notes` | Personal notes, meeting notes, brainstorming |
| `transcript` | Conversation transcript, interview transcript |

### `facet_type` — Structural Kind of Document

| Value | Description |
|-------|-------------|
| `entity` | About a specific thing (a tool, framework, model, product) |
| `concept` | About an idea or pattern (agent memory, faceted classification) |
| `tutorial` | How to do something step-by-step |
| `analysis` | Opinion, evaluation, comparison, critique |
| `reference` | Forms, specifications, standards, lookup tables |
| `synthesis` | Combined insights across multiple sources |
| `cheat-sheet` | Quick reference, commands, shortcuts |

### `facet_stage` — Processing State

| Value | Description |
|-------|-------------|
| `raw` | Normalized to markdown but not analyzed or summarized |
| `summarized` | Structured summary produced (abstracts, key points) |
| `synthesized` | Wisdom-extracted with dynamic sections and conversational bullets |

---

## Controlled Vocabulary

### `facet_domain` — Subject Areas

Open vocabulary with lint-enforced convergence. New domains are added as content enters new areas. Existing domains:

| Domain | Scope |
|--------|-------|
| `agent-systems` | Agent design, orchestration, memory, multi-agent patterns, evaluation |
| `retrieval-systems` | RAG, vector databases, semantic search, BM25, knowledge management |
| `claude-code` | Claude Code features, workflows, best practices, tips |
| `llm-engineering` | LLM optimization, compression, hallucination mitigation, distillation, fine-tuning |
| `machine-learning` | Models, training, benchmarks, evaluations, research methodology |
| `ai-tools` | Frameworks, platforms, developer tools, SDKs |
| `ai-industry` | Economics, trends, market analysis, developer experience |
| `ai-alignment` | Safety, alignment, personas, human behavior simulation |
| `finance` | Tax, accounting, financial planning, forms, regulations |
| `aviation` | Pilot certification, FAA regulations, procedures, airspace |
| `buddhism` | Dharma, meditation, secular practice, suttas |

### `tags` — Initial Seed Vocabulary

High-frequency tags from existing content (extend as needed):

`ai-agents`, `claude-code`, `rag`, `developer-tools`, `anthropic`, `stanford-hai`, `reinforcement-learning`, `python`, `multi-agent`, `llm`, `automation`, `software-engineering`, `simulation`, `reasoning`, `productivity`, `multimodal`, `mcp`, `local-llm`, `embeddings`, `architecture`, `vector-databases`, `tool-use`, `safety`, `retrieval`, `prompt-engineering`, `production`, `personas`, `open-source`, `observability`, `llm-optimization`, `llm-agents`, `langchain`, `knowledge-management`, `context-window`, `benchmarks`, `agentic-workflows`

---

## Summary Field Guidelines

The `summary` field is the single most important field for LLM retrieval. Guidelines:

1. **15-25 words.** Long enough to be specific, short enough to scan in a catalog.
2. **Opinionated, not descriptive.** "Treat agent memory as systems architecture with four types and deliberate forgetting" beats "This article discusses agent memory approaches."
3. **Specific details.** Include the actual insight, not a meta-description of the topic.
4. **No hedging.** Not "The author suggests that..." — just state the insight.
5. **Standalone.** Must make sense without reading the document body.

**Good:** "Generator-evaluator separation plus sprint contracts produce dramatically better long-running applications than solo agents"
**Bad:** "An article about multi-agent architectures for software development"

---

## Validation Rules

A document is schema-compliant when:

1. All required fields are present in the YAML frontmatter
2. `id` matches pattern `doc-[0-9a-f]{8}`
3. `source_type` is one of the 9 enumerated values
4. `facet_type` is one of the 7 enumerated values
5. `facet_stage` is one of the 3 enumerated values
6. `facet_domain` is a non-empty kebab-case string
7. `facet_topic` is a non-empty kebab-case string
8. `tags` is an array with 3-10 entries
9. `summary` is a non-empty string (15-25 words target)
10. `date_ingested` matches `YYYY-MM-DD` format

---

## Directory Structure

```
/data/library/
├── docs/              # All ingested documents (one .md per document)
├── assets/            # Non-text media extracted during ingestion
│   └── {document-id}/ # Per-document subdirectory (e.g., assets/doc-a1b2c3d4/)
│       ├── image-1.png
│       ├── image-2.jpg
│       └── ...
├── inbox/             # Staging area for documents awaiting ingestion
├── CATALOG.md         # Auto-generated document index
└── SCHEMA.md          # This file
```

### Assets Directory Convention

Non-text media (images, diagrams, figures) extracted during ingestion are stored in `/data/library/assets/{document-id}/`. Each document with extracted images gets its own subdirectory named by its `id` field.

**Naming:** Images are named sequentially: `image-1.ext`, `image-2.ext`, etc., preserving the original file extension.

**Filtering:** Images smaller than 5KB are discarded as decorative (logos, borders, icons) and not stored.

**References in document body:** Image references use relative Markdown paths from the document's location in `docs/`:

```markdown
![alt-text](../assets/doc-a1b2c3d4/image-1.png)
```

**Alt-text:** Preserved from original HTML `alt` attributes when descriptive (>10 characters). Otherwise, generated as a brief description of the image content.

---

## Grep Patterns for LLM Retrieval

**Pattern convention:** Always use `.*` between field name and value to accommodate both quoted and unquoted YAML values. Always use field prefix — never bare keywords.

For the full retrieval workflow, see `~/.claude/skills/Corpus/Workflows/Search.md`.

```bash
# Find all documents in a domain
Grep "facet_domain:.*agent-systems" /data/library/docs/

# Find all tutorials
Grep "facet_type:.*tutorial" /data/library/docs/

# Find documents about a specific topic
Grep "facet_topic:.*memory" /data/library/docs/

# Find by tag
Grep "tags:.*context-window" /data/library/docs/

# Find by summary content
Grep "summary:.*memory" /data/library/docs/

# Find synthesized documents only
Grep "facet_stage:.*synthesized" /data/library/docs/

# Multi-keyword OR search
Grep "memory|context-window|retrieval" /data/library/CATALOG.md
```

---

## References

- RFC 0001: The Faceted Plain-Text Lake Architecture
- Ranganathan's PMEST (Personality, Matter, Energy, Space, Time)
- Karpathy LLM Wiki Architecture (raw/wiki/index pattern)
