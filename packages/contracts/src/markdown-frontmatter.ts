// T021 — Markdown + YAML frontmatter parser/serializer.
//
// References: contracts/resource-document.md §"Adapter behavior",
// data-model.md §"DocumentPayload" frontmatter v1 minimum field set.
//
// Splits on the standard `---` delimiters that Jekyll/Hugo/Obsidian/etc. all
// use. Returns the body verbatim (post-frontmatter) and the parsed YAML
// frontmatter as an object. The yaml helper from `./yaml.ts` is the single
// YAML reader (Constitution V).
//
// Round-trip discipline: parseMarkdownWithFrontmatter and
// stringifyMarkdownWithFrontmatter are lossless on canonical inputs (the
// frontmatter is sorted by key for stable snapshots; the body is preserved
// byte-for-byte).

import { load } from 'js-yaml';
import { stringifyYaml } from './yaml.js';
import { FrontmatterParseError } from './errors.js';

export interface MarkdownWithFrontmatter {
  body: string;
  frontmatter: Record<string, unknown>;
}

const FRONTMATTER_DELIMITER = '---';

/**
 * Parse a Markdown document that MAY have a leading YAML frontmatter block
 * delimited by `---` lines. Returns:
 *   - { body: <full input>, frontmatter: {} } if no frontmatter block exists
 *   - { body: <post-frontmatter content>, frontmatter: <parsed YAML> } else
 *
 * Throws FrontmatterParseError on:
 *   - Unterminated frontmatter block (opening `---` but no closing `---`)
 *   - Malformed YAML in the frontmatter block
 */
export function parseMarkdownWithFrontmatter(
  text: string,
): MarkdownWithFrontmatter {
  // Detect the opening delimiter — must be at the very start of the file,
  // optionally preceded by a single newline (some editors append). The line
  // MUST be exactly `---`.
  const lines = text.split('\n');
  if (lines[0] !== FRONTMATTER_DELIMITER) {
    return { body: text, frontmatter: {} };
  }

  // Find the closing delimiter (next line that is exactly `---`).
  let closingIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FRONTMATTER_DELIMITER) {
      closingIdx = i;
      break;
    }
  }
  if (closingIdx === -1) {
    throw new FrontmatterParseError({
      details: 'unterminated frontmatter block (opening `---` has no matching closing `---`)',
    });
  }

  const yamlBlock = lines.slice(1, closingIdx).join('\n');
  const body = lines.slice(closingIdx + 1).join('\n');

  let parsed: unknown;
  try {
    // Use load() directly here (NOT parseYaml) because the frontmatter block
    // does not start with `---` (we stripped that delimiter), so there is no
    // multi-doc-stream concern. Calling parseYaml would mis-classify the
    // delimiter when the body happens to contain another `---`.
    parsed = load(yamlBlock);
  } catch (err) {
    throw new FrontmatterParseError(
      { details: (err as Error).message ?? String(err) },
      err,
    );
  }

  if (parsed === null || parsed === undefined) {
    return { body, frontmatter: {} };
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FrontmatterParseError({
      details: 'frontmatter must parse to an object (got array or scalar)',
    });
  }

  return { body, frontmatter: parsed as Record<string, unknown> };
}

/**
 * Inverse of parseMarkdownWithFrontmatter. Round-trip lossless on canonical
 * inputs — stable key ordering in the frontmatter, body preserved verbatim.
 */
export function stringifyMarkdownWithFrontmatter(
  input: MarkdownWithFrontmatter,
): string {
  const { body, frontmatter } = input;
  const yamlBlock = stringifyYaml(frontmatter);
  // stringifyYaml adds a trailing newline already; we just sandwich.
  return `${FRONTMATTER_DELIMITER}\n${yamlBlock}${FRONTMATTER_DELIMITER}\n${body}`;
}
