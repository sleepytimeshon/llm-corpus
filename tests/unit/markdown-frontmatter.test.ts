// T015 — Unit test: parseMarkdownWithFrontmatter / stringifyMarkdownWithFrontmatter.
//
// References: contracts/resource-document.md §"Adapter behavior",
// Constitution V (single YAML library — js-yaml).

import { describe, it, expect } from 'vitest';
import {
  parseMarkdownWithFrontmatter,
  stringifyMarkdownWithFrontmatter,
} from '../../packages/contracts/src/markdown-frontmatter.js';

describe('parseMarkdownWithFrontmatter() (T015)', () => {
  it('splits on standard --- delimiters and parses YAML', () => {
    const input = `---
id: doc-ab12cd34
source_path: /inbox/foo.md
ingest_timestamp: '2026-05-15T14:30:00Z'
mime_type: text/markdown
hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
---
# Hello

This is the body.
`;
    const { body, frontmatter } = parseMarkdownWithFrontmatter(input);
    expect((frontmatter as { id?: string }).id).toBe('doc-ab12cd34');
    expect((frontmatter as { mime_type?: string }).mime_type).toBe(
      'text/markdown',
    );
    expect(body.startsWith('# Hello')).toBe(true);
    expect(body).toContain('This is the body.');
    // body MUST not contain the frontmatter block
    expect(body).not.toContain('id: doc-ab12cd34');
  });

  it('returns empty frontmatter and verbatim body when no frontmatter block', () => {
    const input = `# No Frontmatter

Just body text.
`;
    const { body, frontmatter } = parseMarkdownWithFrontmatter(input);
    expect(frontmatter).toEqual({});
    expect(body).toBe(input);
  });

  it('rejects unterminated frontmatter block with a typed error', () => {
    const input = `---
id: doc-ab12cd34
title: never closed

# Body looks like body but no second ---`;
    expect(() => parseMarkdownWithFrontmatter(input)).toThrow();
  });

  it('rejects malformed YAML inside the block', () => {
    const input = `---
id: doc-ab12cd34
broken: : yaml :
---
body
`;
    expect(() => parseMarkdownWithFrontmatter(input)).toThrow();
  });

  it('handles the common case: frontmatter at start, body follows', () => {
    const input = `---
title: foo
---
body
`;
    const { body, frontmatter } = parseMarkdownWithFrontmatter(input);
    expect((frontmatter as { title?: string }).title).toBe('foo');
    expect(body.trim()).toBe('body');
  });
});

describe('stringifyMarkdownWithFrontmatter() (T015)', () => {
  it('round-trip is lossless on canonical inputs', () => {
    const frontmatter = {
      id: 'doc-ab12cd34',
      source_path: '/inbox/foo.md',
      ingest_timestamp: '2026-05-15T14:30:00Z',
      mime_type: 'text/markdown',
      hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    };
    const body = '# Hello\n\nWorld.\n';
    const serialized = stringifyMarkdownWithFrontmatter({ body, frontmatter });
    const parsed = parseMarkdownWithFrontmatter(serialized);
    expect(parsed.body.trim()).toBe(body.trim());
    expect((parsed.frontmatter as { id?: string }).id).toBe(frontmatter.id);
    expect((parsed.frontmatter as { hash?: string }).hash).toBe(frontmatter.hash);
  });

  it('emits a leading --- delimiter and trailing ---', () => {
    const out = stringifyMarkdownWithFrontmatter({
      body: 'b',
      frontmatter: { x: 1 },
    });
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('\n---\n');
  });
});
