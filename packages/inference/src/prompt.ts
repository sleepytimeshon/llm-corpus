// SP-004 US1 (T032) — Classifier prompt renderer.
//
// References:
//   - specs/004-classifier/spec.md FR-CLASSIFY-006, FR-CLASSIFY-014,
//     FR-CLASSIFY-020
//   - specs/004-classifier/research.md Decision C (system + single user-turn)
//   - specs/004-classifier/research.md Decision H (2000-codepoint cap)
//   - specs/004-classifier/data-model.md §"Entity 2 — EstablishedVocabulary"
//   - Constitution Principle V (Schema-Enforced Structured Output)
//   - Constitution Principle XV (Dynamic Taxonomy)
//
// Two-message conversation:
//
//   1. System message — names the structured-output contract + classification
//      rules. Stable across documents within a single vocabulary snapshot.
//
//   2. User message — vocabulary block + classification rules summary +
//      document title/source/mime + the first 2000 codepoints of body.
//
// FACET_TYPE_VALUES is named explicitly in the system message (the
// constitutional 7-value enum per FR-CLASSIFY-014). Domain + tag axes are
// rendered from the live snapshot — NO hardcoded `enum FacetDomain`.

import type { EstablishedVocabulary } from './vocabulary.js';
import { FACET_TYPE_VALUES } from '@llm-corpus/contracts';

export interface ClassifierPromptDoc {
  title: string;
  sourcePath: string;
  mimeType: string;
  body: string;
}

export interface ClassifierPrompt {
  systemMessage: string;
  userMessage: string;
}

const BODY_CODEPOINT_CAP = 2000;

/**
 * Truncate `text` at a codepoint boundary safe under UTF-16 surrogate
 * pairs (Decision H). Uses Array.from + Array.slice so a surrogate pair at
 * the boundary is treated atomically (slice never splits a pair). Joining
 * with the empty string reassembles a well-formed UTF-16 string for the
 * JSON.stringify-into-undici-body path.
 */
export function truncateToCodepoints(text: string, max: number): string {
  // Array.from on a string iterates by codepoint (handles surrogate pairs).
  const codepoints = Array.from(text);
  if (codepoints.length <= max) {
    return text;
  }
  return codepoints.slice(0, max).join('');
}

function renderSystemMessage(): string {
  const types = FACET_TYPE_VALUES.join(', ');
  return [
    'You are a corpus classification assistant. Read the document below and',
    'emit JSON matching the structured-output schema provided in the chat API.',
    '',
    'Rules:',
    '- facet_domain MUST be one of the established domains listed in the user',
    '  message, OR you may propose a new domain via the optional',
    '  facet_domain_proposed field (and choose the closest-fitting established',
    '  value for facet_domain).',
    '- tags MUST be 3-10 entries drawn from the established tags listed below.',
    '  Propose new tags via facet_tags_proposed (and include established tags',
    '  in `tags` for any that already match).',
    `- facet_type MUST be one of: ${types}.`,
    '- summary MUST be 15-25 words capturing the document\'s core insight.',
    '- confidence sub-scores ∈ [0, 1] indicate your certainty on each axis.',
    'Do NOT include any field not present in the schema. Output strict JSON only.',
  ].join('\n');
}

function renderUserMessage(
  vocab: EstablishedVocabulary,
  doc: ClassifierPromptDoc,
): string {
  // Sort vocab for deterministic prompt output (Decision E + Decision C —
  // identical snapshot → identical prompt). The vocabulary sets are
  // unordered conceptually; sorted, joined comma-separated.
  const domains = [...vocab.domains].sort().join(', ');
  const tags = [...vocab.tags].sort().join(', ');
  const bodyExcerpt = truncateToCodepoints(doc.body, BODY_CODEPOINT_CAP);
  return [
    '## Established vocabulary',
    '',
    `Domains: ${domains}`,
    `Tags: ${tags}`,
    '',
    '## Document',
    '',
    `Title: ${doc.title}`,
    `Source: ${doc.sourcePath}`,
    `MIME: ${doc.mimeType}`,
    '',
    bodyExcerpt,
  ].join('\n');
}

/**
 * Render the two-message conversation for the Ollama `/api/chat` POST.
 * Deterministic across calls with identical input.
 */
export function renderClassifierPrompt(
  vocab: EstablishedVocabulary,
  doc: ClassifierPromptDoc,
): ClassifierPrompt {
  return {
    systemMessage: renderSystemMessage(),
    userMessage: renderUserMessage(vocab, doc),
  };
}
