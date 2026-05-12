// T027 (SP-003) — filename sanity rejection BEFORE content read.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { validateInboxFile } from '../../packages/pipeline/src/validation-gate.js';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('validateInboxFile filename sanity (T027)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('path-traversal sequences (..) rejected by filename sanity', async () => {
    // The basename contains ".." — should be rejected without any content read.
    const result = await validateInboxFile('/nonexistent/dir/..', new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data.error_code).toBe('filename_sanity_failed');
    }
  });

  it('null-byte basename rejected', async () => {
    // We pass a string containing a null byte in the basename.
    const result = await validateInboxFile(
      '/tmp/sneaky\0name.md',
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data.error_code).toBe('filename_sanity_failed');
    }
  });

  it('control character in name rejected', async () => {
    // Tab character in filename basename.
    const result = await validateInboxFile(
      '/tmp/file\twith\ttab.md',
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data.error_code).toBe('filename_sanity_failed');
    }
  });
});
