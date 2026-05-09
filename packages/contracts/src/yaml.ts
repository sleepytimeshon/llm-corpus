// T020 — Single-source YAML helpers (Constitution V — single YAML library).
//
// SP-002 introduces the project's first YAML reader. Per Constitution V,
// EVERY YAML reader in this codebase routes through these two helpers; no
// hand-rolled regex frontmatter splitting, no alternate YAML libraries, no
// `yaml.loadAll` (multi-document streams are forbidden — corpus documents
// are single-document YAML frontmatter blocks).
//
// References: plan.md R5, contracts/resource-document.md "Adapter behavior".

import { load, dump } from 'js-yaml';

/**
 * Parse a single-document YAML string. Returns the parsed value (object,
 * array, scalar, or null for empty input). Throws on malformed YAML or
 * multi-document streams.
 *
 * Constitution V: single YAML library — never use yaml.loadAll, never
 * hand-parse YAML elsewhere in the project.
 */
export function parseYaml(text: string): unknown {
  // js-yaml's `load` returns the first document of a multi-doc stream
  // silently — we explicitly reject that. Detect by counting `---` document
  // separators at line starts. (Trivial leading `---` is a frontmatter
  // delimiter handled by markdown-frontmatter.ts, NOT here.)
  const docSeparators = countDocumentSeparators(text);
  if (docSeparators >= 2) {
    throw new Error(
      'parseYaml: multi-document YAML streams are forbidden (Constitution V). ' +
        'Use parseMarkdownWithFrontmatter for frontmatter+body documents.',
    );
  }
  return load(text);
}

/**
 * Stringify a value as YAML with stable key ordering (deterministic
 * snapshots — required for round-trip + reproducible test fixtures).
 */
export function stringifyYaml(value: unknown): string {
  return dump(value, {
    sortKeys: true,
    lineWidth: -1, // preserve long strings without folding
    noRefs: true, // no anchors/aliases — keep YAML self-contained
  });
}

/**
 * Count `---` document separator lines at the start of a line.
 * Two or more = multi-document stream (forbidden).
 */
function countDocumentSeparators(text: string): number {
  // A document separator is a line consisting of exactly `---` (or `--- `
  // followed by directives). Since js-yaml accepts a leading `---` as a
  // start-of-document marker for a SINGLE document, two-or-more is what
  // signals a multi-doc stream.
  let count = 0;
  for (const line of text.split('\n')) {
    if (line === '---' || line.startsWith('--- ')) {
      count++;
      if (count >= 2) return count;
    }
  }
  return count;
}
