---
artifact: PERSONAS
project_slug: llm-corpus
stage: 1-frame
tier: deep
template_version: 3.0.0
generated: 2026-04-26T01:40:00-07:00
generated_by: ProductDevelopment Skill v1.0
supersedes: null
product_type: software

counts:
  personas_total: 3
completeness:
  every_persona_has_name: true
  every_persona_has_role: true
  every_persona_has_named_pain: true
  every_persona_has_quote: true
  every_persona_has_opportunities: true
links:
  opportunity_tree: ./OPPORTUNITY-TREE.yaml
  charter: ./CHARTER.md
sources:
  decisions: ./ledgers/decisions.jsonl
  concerns: ./ledgers/concerns.jsonl
  questions: ./ledgers/questions.jsonl
---

# Personas — llm-corpus

## P-001 — Maya R.

| Field | Value |
|---|---|
| **id** | `P-001` |
| **name** | Maya R. |
| **role** | Senior policy researcher at a 4-person climate think tank, three years in, primary user of Claude Code for drafting briefs and synthesizing literature |
| **primary_pain** | Spent 90 minutes last Thursday re-feeding the same eight IPCC AR6 chapter PDFs into Claude Code because the previous session ended and the agent had no recall of the 200+ papers, transcripts, and committee minutes already sitting in her ~/Research folder |
| **key_quote** | "I have read every one of these papers. Claude has read none of them, every single morning, forever. I am not a librarian for a model that forgets me at midnight." |
| **opportunities_they_care_about** | [OPP-001, OPP-002, OPP-003, OPP-004, OPP-008] |
| **anti_personas** | Casual ChatGPT users who treat the model as a search engine; she needs grounded, citable retrieval against material she chose, not generic synthesis. |

**Context:** Works on a 14" MacBook Pro, primary tools are Claude Code in iTerm2, Zotero for citation management, and a flat ~/Research/ Markdown vault she maintains in Obsidian for human reading. Tried Obsidian Smart Connections for six weeks — local semantic search worked but there was no programmatic surface for Claude to call, so she was still copy-pasting passages into the terminal. NotebookLM was fast and useful until her org's legal counsel banned uploading unpublished partner-org drafts to Google.

---

## P-002 — David Okafor

| Field | Value |
|---|---|
| **id** | `P-002` |
| **name** | David Okafor |
| **role** | Sole-practitioner tax attorney, 11 years in practice, handles IRS controversy and high-net-worth estate work for ~40 active clients |
| **primary_pain** | In March he asked Claude to summarize the §199A QBI threshold phase-out for a client memo and it confidently cited a regulation paragraph that does not exist; he caught it only because he cross-checked against his own annotated CCH library, and the realization that an associate without his 11 years would have shipped the error to a client kept him from using cloud LLMs on any client matter for two months |
| **key_quote** | "I am not uploading client tax returns to a cloud RAG. Full stop. But I also cannot keep manually feeding the model the same 600 pages of Treasury regs every time I open a new chat. There has to be a third option." |
| **opportunities_they_care_about** | [OPP-001, OPP-003, OPP-005, OPP-007] |
| **anti_personas** | Hobbyist developers experimenting with local LLMs for fun; he has billable-hour stakes and zero tolerance for hallucinated citations or cloud egress of client data. |

**Context:** Runs a Mac Studio with Ollama serving Llama 3.3 70B locally for any work that touches client PII; uses Claude Code only for non-privileged drafting (blog posts, CLE outlines). His reference library is ~3,400 PDFs of IRS publications, Tax Court decisions, Treasury regs, and PLRs, organized in a hand-curated folder hierarchy he stopped maintaining around document #800 because tagging at intake cost him fifteen minutes per filing. Tried Devonthink's built-in concept search — useful for him, useless to the local model.

---

## P-003 — Priya

| Field | Value |
|---|---|
| **id** | `P-003` |
| **name** | Priya |
| **role** | Independent ML researcher running Llama 3.3 and Qwen 2.5 locally on a dedicated Linux workstation; writes a Substack on small-model evaluation |
| **primary_pain** | Her local 70B model has no idea what BEIR is, has never read the Self-RAG paper, and cannot tell her which of the 180 arxiv preprints she has downloaded this year are relevant to a question about reciprocal rank fusion — every conversation starts at the model's training cutoff with zero awareness of the corpus that defines her actual research frontier |
| **key_quote** | "I went local because I wanted the model to be mine. Then I realized 'mine' meant it knew nothing about what I actually work on. The model is a brain with no library card." |
| **opportunities_they_care_about** | [OPP-002, OPP-004, OPP-006, OPP-008] |
| **anti_personas** | Cloud-API-dependent researchers; the entire point for her is that nothing leaves the workstation. |

**Context:** Workstation is Ubuntu 24.04, RTX 4090, Ollama for serving, ~/papers/ contains 2,100 arxiv PDFs and conference proceedings going back four years. Tried building her own ChromaDB pipeline last summer — got embeddings working in a weekend, abandoned it three weeks later because keeping the index synchronized with new downloads, handling re-embeds when she swapped models, and exposing it to her local LLM in a way the model would actually use turned into a part-time second job. Wants the substrate, not the substrate-construction project.

---

## Persona-to-opportunity matrix

| Persona | OPP-001 | OPP-002 | OPP-003 | OPP-004 | OPP-005 | OPP-006 | OPP-007 | OPP-008 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **P-001 Maya R.**       | ✓ | ✓ | ✓ | ✓ |   |   |   | ✓ |
| **P-002 David Okafor**  | ✓ |   | ✓ |   | ✓ |   | ✓ |   |
| **P-003 Priya**         |   | ✓ |   | ✓ |   | ✓ |   | ✓ |

## Adversary-pass instructions (for downstream agents)

When Stage 2-6 gates run a persona adversary pass against this file, each adversary agent should:

1. Pick one persona block above and read all six fields plus the context paragraph.
2. Read the artifact under review (OPPORTUNITY-TREE.yaml at Frame; REQUIREMENTS.yaml at Spec; ROADMAP.yaml at Plan; etc.).
3. Find ONE specific item — citing its `OPP-NNN`, `SOL-NNN-X`, `FR-NNN`, `RM-NNN`, or scenario name — that this persona would object to.
4. Append the objection to `ledgers/concerns.jsonl` with `kind: risk` (if specific cite) or `kind: assumption` (if vague), `source: persona-adversary`, `cite_id` set when blocking.

Per design v2 §10: vague objections (no cite_id) are logged but do not block the gate. Only objections citing a specific ID count as blocking.

---

*Charter: [`./CHARTER.md`](./CHARTER.md) · Opportunity tree: [`./OPPORTUNITY-TREE.yaml`](./OPPORTUNITY-TREE.yaml) · Anti-goals: [`./ANTI-GOALS.md`](./ANTI-GOALS.md)*
