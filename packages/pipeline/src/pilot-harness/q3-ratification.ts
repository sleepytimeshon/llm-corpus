// SP-000-Lite Phase 3 (T019) — Q3 ratification gate.
//
// FR-PILOT-012: running the pilot harness against an unratified DRAFT Q3
// (Retrieval Pattern Operational Definitions) section is FORBIDDEN. Shon
// authors a `<!-- ratified: true -->` HTML-comment marker on each of the
// three pattern sub-sections at PR-walkthrough time (per tasks.md T019/T021).
// The harness verifies all three markers are present before starting.
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T013, T019
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-012
//   - specs/000-nfr-008-pilot-lite/contracts/query-set.feature
//   - Constitution Principle XI (Result<T,E> — no throw, no exit)

import { ok, err, type Result } from '@llm-corpus/contracts/result';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RetrievalPatternName =
  | 'factual_lookup'
  | 'recall_by_context'
  | 'multi_doc_synthesis';

export interface RatificationStatus {
  readonly ratified: true;
  readonly patterns: ReadonlyArray<RetrievalPatternName>;
  readonly marker_count: 3;
}

export type RatificationError =
  | {
      readonly code: 'SECTION_MISSING';
      readonly message: string;
      readonly citation: 'FR-PILOT-012';
    }
  | {
      readonly code: 'MARKER_COUNT_MISMATCH';
      readonly expected: 3;
      readonly actual: number;
      readonly citation: 'FR-PILOT-012';
      readonly message: string;
    }
  | {
      readonly code: 'MARKER_OUT_OF_SECTION';
      readonly offset: number;
      readonly citation: 'FR-PILOT-012';
      readonly message: string;
    }
  | {
      readonly code: 'PATTERN_SUBSECTION_MISSING_MARKER';
      readonly pattern: RetrievalPatternName;
      readonly citation: 'FR-PILOT-012';
      readonly message: string;
    }
  | {
      readonly code: 'PATTERN_SUBSECTION_DUPLICATE_MARKER';
      readonly pattern: RetrievalPatternName;
      readonly actual: number;
      readonly citation: 'FR-PILOT-012';
      readonly message: string;
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATIFICATION_MARKER = '<!-- ratified: true -->';
const SECTION_HEADER = '## Retrieval Pattern Operational Definitions';
const PATTERN_NAMES: ReadonlyArray<RetrievalPatternName> = [
  'factual_lookup',
  'recall_by_context',
  'multi_doc_synthesis',
];

// ---------------------------------------------------------------------------
// verifyQ3Ratified — the public entry point.
// ---------------------------------------------------------------------------

/**
 * Verify that a spec source text carries exactly three
 * `<!-- ratified: true -->` markers — one under each of the three
 * `### \`factual_lookup\`` / `recall_by_context` / `multi_doc_synthesis`
 * sub-headers of `## Retrieval Pattern Operational Definitions`.
 *
 * Returns `Result.Ok(RatificationStatus)` when all three markers are present
 * inside the operational-definitions section with one per sub-header;
 * `Result.Err(RatificationError)` otherwise. The error always cites
 * `FR-PILOT-012` so the CLI surface can render an actionable message.
 *
 * Constitution V: structured parsing only — no regex over the whole document.
 * We locate section boundaries by string-prefix matching on `## ` headings
 * and per-sub-section matching on `### ` headings, both stable Markdown
 * conventions.
 */
export function verifyQ3Ratified(
  specSource: string,
): Result<RatificationStatus, RatificationError> {
  // --- 1. Locate the section bounds ---------------------------------------
  const sectionStart = specSource.indexOf(SECTION_HEADER);
  if (sectionStart === -1) {
    return err({
      code: 'SECTION_MISSING',
      message:
        `FR-PILOT-012: spec is missing the "${SECTION_HEADER}" section. ` +
        'Ratification cannot be verified.',
      citation: 'FR-PILOT-012',
    });
  }

  // Find the next `## ` heading after the section header, OR end-of-file.
  // We search line-by-line so `### ` sub-headers don't match.
  const afterSection = specSource.slice(sectionStart + SECTION_HEADER.length);
  const nextSectionMatch = afterSection.match(/\n##\s/);
  const sectionEnd =
    nextSectionMatch !== null && nextSectionMatch.index !== undefined
      ? sectionStart + SECTION_HEADER.length + nextSectionMatch.index
      : specSource.length;

  const sectionText = specSource.slice(sectionStart, sectionEnd);

  // --- 2. Count markers across the WHOLE document --------------------------
  const totalMarkers = countOccurrences(specSource, RATIFICATION_MARKER);
  if (totalMarkers !== 3) {
    return err({
      code: 'MARKER_COUNT_MISMATCH',
      expected: 3,
      actual: totalMarkers,
      citation: 'FR-PILOT-012',
      message:
        `FR-PILOT-012: expected exactly 3 \`${RATIFICATION_MARKER}\` markers ` +
        `(one per retrieval pattern); found ${totalMarkers}.`,
    });
  }

  // --- 3. All markers must live INSIDE the section ------------------------
  const sectionMarkerCount = countOccurrences(sectionText, RATIFICATION_MARKER);
  if (sectionMarkerCount !== 3) {
    // We know totalMarkers === 3 but section count != 3 → at least one is
    // outside the operational-definitions section.
    return err({
      code: 'MARKER_OUT_OF_SECTION',
      offset: sectionStart,
      citation: 'FR-PILOT-012',
      message:
        'FR-PILOT-012: one or more ratification markers appear outside ' +
        `the "${SECTION_HEADER}" section. All three markers MUST appear ` +
        'inside that section.',
    });
  }

  // --- 4. Each pattern sub-section carries exactly one marker -------------
  const patternRanges = locatePatternSubsections(sectionText);
  for (const pat of PATTERN_NAMES) {
    const range = patternRanges.get(pat);
    if (range === undefined) {
      return err({
        code: 'PATTERN_SUBSECTION_MISSING_MARKER',
        pattern: pat,
        citation: 'FR-PILOT-012',
        message:
          `FR-PILOT-012: pattern sub-section for \`${pat}\` is missing ` +
          `(or has no \`${RATIFICATION_MARKER}\` marker).`,
      });
    }
    const subText = sectionText.slice(range.start, range.end);
    const subMarkers = countOccurrences(subText, RATIFICATION_MARKER);
    if (subMarkers === 0) {
      return err({
        code: 'PATTERN_SUBSECTION_MISSING_MARKER',
        pattern: pat,
        citation: 'FR-PILOT-012',
        message:
          `FR-PILOT-012: \`${pat}\` sub-section has no ratification marker.`,
      });
    }
    if (subMarkers > 1) {
      return err({
        code: 'PATTERN_SUBSECTION_DUPLICATE_MARKER',
        pattern: pat,
        actual: subMarkers,
        citation: 'FR-PILOT-012',
        message:
          `FR-PILOT-012: \`${pat}\` sub-section carries ${subMarkers} markers; ` +
          'exactly one is permitted.',
      });
    }
  }

  return ok({
    ratified: true,
    patterns: PATTERN_NAMES,
    marker_count: 3,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Locate the `[start, end)` offsets (relative to `sectionText`) of each
 * `### \`<pattern>\`` sub-section. End is the next `### ` heading or
 * `sectionText.length` (since the caller already trimmed at the next `## `).
 *
 * Pattern names can appear in sub-headers in any of these forms:
 *   - `` ### `factual_lookup` ``
 *   - `### factual_lookup`
 *   - `` ### `factual_lookup` <!-- ratified: true --> ``
 * We anchor on `### ` (heading) + the bare pattern name as a substring.
 */
function locatePatternSubsections(
  sectionText: string,
): Map<RetrievalPatternName, { start: number; end: number }> {
  const result = new Map<RetrievalPatternName, { start: number; end: number }>();
  // Find all `### ` heading positions.
  const headings: Array<{ offset: number; line: string }> = [];
  const lines = sectionText.split('\n');
  let runningOffset = 0;
  for (const line of lines) {
    if (line.startsWith('### ')) {
      headings.push({ offset: runningOffset, line });
    }
    runningOffset += line.length + 1; // +1 for the newline
  }

  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i];
    if (!h) continue;
    const next = headings[i + 1];
    const start = h.offset;
    const end = next !== undefined ? next.offset : sectionText.length;
    for (const pat of PATTERN_NAMES) {
      if (h.line.includes(pat)) {
        result.set(pat, { start, end });
      }
    }
  }

  return result;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) return count;
    count += 1;
    idx = found + needle.length;
  }
}
