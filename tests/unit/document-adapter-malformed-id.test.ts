// T048 — Unit test: document-adapter rejects malformed ids defensively.
//
// References: FR-008, contracts/mcp-resources-api.md "Validation gates",
// contracts/resource-document.md.
//
// The mcp-server.ts dispatch table rejects malformed URIs at the -32602
// "Invalid params" layer (regex won't match), but the adapter ALSO defends
// against malformed ids — defense in depth. The adapter accepts only ids
// matching /^doc-[0-9a-f]{8}$/.

import { describe, it, expect } from 'vitest';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import { fetchDocument } from '../../packages/storage/src/document-adapter.js';
// Same package-resolved path as the adapter — see config-loader.test.ts for
// rationale (instanceof requires shared class identity).
import { DocumentNotFoundError } from '@llm-corpus/contracts';

describe('fetchDocument() malformed id rejection (T048 / FR-008)', () => {
  it.each([
    ['empty', ''],
    ['no-prefix', 'ab12cd34'],
    ['wrong-prefix', 'document-ab12cd34'],
    ['too-short', 'doc-ab12cd3'],
    ['too-long', 'doc-ab12cd345'],
    ['uppercase-hex', 'doc-AB12CD34'],
    ['non-hex', 'doc-zzzzzzzz'],
    ['contains-slash', 'doc-ab12/cd34'],
    ['sql-injection-attempt', "doc-aaaaaaaa' OR '1'='1"],
  ])(
    'returns DocumentNotFoundError for malformed id (%s)',
    async (_label, badId) => {
      const handle = await loadFixture(`doc-malformed-${_label}`, null);
      try {
        process.env.CORPUS_HOME = handle.rootDir;
        const ac = new AbortController();
        const result = await fetchDocument(badId, ac.signal);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBeInstanceOf(DocumentNotFoundError);
      } finally {
        delete process.env.CORPUS_HOME;
        handle.cleanup();
      }
    },
  );
});
