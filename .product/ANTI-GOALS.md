---
artifact: ANTI-GOALS
project_slug: llm-corpus
stage: 1-frame
tier: deep
template_version: 3.0.0
generated: 2026-04-26T01:40:00-07:00
generated_by: ProductDevelopment Skill v1.0
supersedes: null
product_type: software

counts:
  anti_goals_total: 5
  by_source:
    user_explicit: 3
    redteam: 2
    inferred: 0
completeness:
  every_anti_goal_complete: true
  every_anti_goal_has_revisit: true
links:
  charter: ./CHARTER.md
  opportunity_tree: ./OPPORTUNITY-TREE.yaml
  requirements: null
sources:
  decisions: ./ledgers/decisions.jsonl
  concerns: ./ledgers/concerns.jsonl
  questions: ./ledgers/questions.jsonl
---

# Anti-Goals — llm-corpus

## What this file is for

Anti-goals are explicit out-of-scope declarations — things llm-corpus deliberately will NOT do, with documented rationale and a revisit condition that says when the call would be re-opened. They are written in Stage 1 because they are framing-level decisions; downstream stages reference them but do not author new ones (new anti-goals at Stage 2+ trigger a re-Frame loop via remediation_tree.moderate).

## AG-001

| Field | Value |
|---|---|
| **id** | `AG-001` |
| **item** | No human-facing UI for browsing, editing, or chatting with documents |
| **rationale** | The corpus is an agent substrate; the agent IS the UI. Building a browse/edit/chat surface would re-create Obsidian, NotebookLM, AnythingLLM, and Logseq AI — products that already exist and are explicitly NOT what this system is for. |
| **revisit_condition** | If after 90 days of v1 use, ≥30% of Shon's corpus interactions happen outside an agent session (e.g., direct grep, manual editing of frontmatter), the no-UI stance becomes a friction point worth revisiting. |
| **source** | user_explicit |
| **related_anti_personas** | [] |
| **estimated_revisit_horizon** | post-v1 + 90 days |

**Why now:** Whitepaper §3.5 makes the agent surface canonical: "The corpus exposes its read surface to integrating agents through a Model Context Protocol server." The system is positioned against NotebookLM (cloud RAG with chat UI) and Smart Connections (local PKM with editor view). A UI would dissolve the differentiation.

---

## AG-002

| Field | Value |
|---|---|
| **id** | `AG-002` |
| **item** | No LLM-generated or LLM-rewritten content in the document store |
| **rationale** | The user is the authority on what enters the corpus and on what each document says. The LLM classifies and retrieves; it never authors. Karpathy's "LLM-as-compiler" wiki is the contrast — that system rewrites raw sources into derived pages; this one does not. |
| **revisit_condition** | If a generative-content workflow (e.g., user wants the corpus to hold AI-synthesized literature reviews) emerges as a recurring pattern, consider a separate `synthesis/` namespace with explicit `origin: ai-generated` frontmatter — but never silently mix into the canonical store. |
| **source** | user_explicit |
| **related_anti_personas** | [] |
| **estimated_revisit_horizon** | v2 |

**Why now:** Whitepaper §2.3 explicitly contrasts with Karpathy LLM Wiki: "in this system the LLM is a classifier and a retrieval target, not a compiler. The user remains the authority on what enters the corpus." Architecture lint rules forbid `origin`, `provenance_*`, `confidence`, and `corpus capture` mutations.

---

## AG-003

| Field | Value |
|---|---|
| **id** | `AG-003` |
| **item** | No conversation memory, no SaaS connectors, no multi-user/team model |
| **rationale** | Memory systems address the **personality problem** (preferences, habits, observations — agent-side state about the user). llm-corpus addresses the **experience problem** (the user's domain-specific knowledge, which an LLM trained on broad data does not have). Different objects, different lifecycles. Conversation memory belongs to Mem0/Letta/auto-memory. SaaS connectors belong to Danswer/Onyx-class enterprise search. Multi-user belongs to those products too. |
| **revisit_condition** | Conversation memory: revisit only if a user-initiated workflow ("save this conversation as a corpus document") becomes recurring; even then, the conversation goes through ingest as a normal document, not as a memory primitive. SaaS connectors: never. Multi-user: never. |
| **source** | user_explicit |
| **related_anti_personas** | [] |
| **estimated_revisit_horizon** | never |

**Why now:** Whitepaper §4 draws the knowledge-vs-memory line as a definitional axiom; §3.6 specifies single-machine local operation. The personality-vs-experience framing (PM-Review 2026-04-26) sharpens the rationale: an agent serving a user well needs both — but they are not the same object and should not share a substrate. Cross-cutting these would dissolve every other design principle.

---

## AG-004

| Field | Value |
|---|---|
| **id** | `AG-004` |
| **item** | No claim of cross-agent validation in v1 — Shon-with-Claude-Code is the validated user; Gemini CLI / Codex CLI / Ollama-served local LLMs are portability claims, not user-validated capability |
| **rationale** | RedTeam pre-flight (concerns.jsonl C-001) flagged that the whitepaper's "any MCP-aware agent" framing is a false plurality. The MCP server may technically work cross-agent, but cross-agent USER VALIDATION requires real users on those agents — which we do not have. Promising it would invite "you said this works on Gemini" complaints downstream. |
| **revisit_condition** | When a second user with a different primary agent (Gemini CLI or Codex CLI) installs and uses the corpus for ≥30 days and reports outcomes, cross-agent claims become validated. Until then: portability is a property of the protocol, not a guarantee of the user experience. |
| **source** | redteam |
| **related_anti_personas** | [] |
| **estimated_revisit_horizon** | post-v1 |

**Why now:** Surfaced by Stage 1 RedTeam pre-flight. The Frame stage refuses to write cross-agent validation into the outcome metric or success criteria; cross-agent compatibility is documented as a portability property of the MCP protocol, not as a user-validated property of v1.

---

## AG-005

| Field | Value |
|---|---|
| **id** | `AG-005` |
| **item** | No formal retrieval evaluation harness in v1 (50-query labeled benchmark deferred to Future Work) |
| **rationale** | RedTeam pre-flight (concerns.jsonl C-003) flagged that the original architecture's success metric — "hit-rate ≥ 0.85 on 50-query harness" — depends on a labeled eval set that does not exist and is listed as Future Work in the whitepaper itself. Building the harness in v1 would conflate substrate development with evaluation methodology. v1 ships with a measurable-today north-star (queries-per-week with user acceptance) and the formal harness is explicitly v1.5+ work. |
| **revisit_condition** | After 30 days of v1 use, if the queries-per-week metric proves insufficient signal (e.g., consistently passes but Shon reports the corpus feels off), revisit the formal harness as v1.5 priority. |
| **source** | redteam |
| **related_anti_personas** | [] |
| **estimated_revisit_horizon** | v1.5 |

**Why now:** Whitepaper §5 explicitly lists "formal retrieval evaluation" as Future Work. Treating it as a v1 success criterion was an architectural overreach the RedTeam caught.

---

## Source breakdown

- `user_explicit` (3): AG-001, AG-002, AG-003 — directly stated in the whitepaper or implied by its principle definitions
- `redteam` (2): AG-004, AG-005 — surfaced by Stage 1 RedTeam pre-flight as scope-bloat or unvalidated-claim risks
- `inferred` (0)

## Conflict-resolution rules

If a future stage proposes a requirement, solution, or scope item that conflicts with an anti-goal here:

1. The proposing stage MUST cite the conflicting `AG-NNN` and either:
   - Mark the proposed item with `quality_flag: conflicts-anti-goal` (Stage 2)
   - Open a `Q-NNN` in `questions.jsonl` asking whether the anti-goal should be revisited
2. The skill does NOT silently override anti-goals. A conflict requires explicit PM-Review approval.
3. If the user approves a revisit, this file is updated with `supersedes:` pointing to the prior version, and the new version drops the affected AG-NNN. The old version is retained in git history.

---

*Charter: [`./CHARTER.md`](./CHARTER.md) · Personas: [`./PERSONAS.md`](./PERSONAS.md) · Opportunity tree: [`./OPPORTUNITY-TREE.yaml`](./OPPORTUNITY-TREE.yaml)*
