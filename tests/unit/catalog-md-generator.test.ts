// SP-006 T044 — Unit test for the CATALOG.md flat-file generator.
//
// RED-phase coverage (Engineer #4 / Phase 5):
//   - formatCatalogLine: pipe-delimited line shape
//   - Pipe-character escape (input '|' → '‖' U+2016)
//   - Codepoint-safe summary truncation to first 200 chars
//   - appendCatalogLine: atomic via withTempDir + fs.appendFile
//   - Idempotent on duplicate doc_id (skip if line already present)
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-018
//   - specs/006-hardening/data-model.md §"Entity 8 — CatalogLine"
//   - specs/006-hardening/research.md Decision L
//   - Constitution Principles VIII (atomic writes), XIV (XDG paths)

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Paths } from '@llm-corpus/contracts';
import {
  appendCatalogLine,
  formatCatalogLine,
  type CatalogLineInput,
} from '../../packages/storage/src/catalog-md-generator.js';

const catalogPath = (): string => path.join(Paths.data(), 'CATALOG.md');

const baseInput: CatalogLineInput = {
  doc_id: 'doc-aaaaaaaa',
  title: 'Hello World',
  facet_domain: 'engineering',
  facet_type: 'reference',
  summary: 'A short summary about the document body.',
};

describe('T044 — formatCatalogLine + appendCatalogLine (US3 P2)', () => {
  let tmpHome: string;
  let originalCorpusHome: string | undefined;

  beforeEach(async () => {
    originalCorpusHome = process.env.CORPUS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-catalog-md-'));
    process.env.CORPUS_HOME = tmpHome;
    await fsp.mkdir(Paths.data(), { recursive: true });
  });

  afterEach(() => {
    if (originalCorpusHome === undefined) {
      delete process.env.CORPUS_HOME;
    } else {
      process.env.CORPUS_HOME = originalCorpusHome;
    }
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it('produces the canonical pipe-delimited line format', () => {
    const line = formatCatalogLine(baseInput);
    expect(line).toBe(
      'doc-aaaaaaaa | Hello World | engineering | reference | A short summary about the document body.\n',
    );
  });

  it('escapes pipe characters in title and summary to U+2016', () => {
    const line = formatCatalogLine({
      ...baseInput,
      title: 'A | B | C',
      summary: 'one | two',
    });
    // The "|" delimiter is reserved; input "|" replaced with "‖" (U+2016).
    expect(line).toContain('A ‖ B ‖ C');
    expect(line).toContain('one ‖ two');
    // The four canonical "|" delimiters survive (one between each of the
    // 5 fields = 4 delimiters).
    const delimiterCount = (line.match(/ \| /g) ?? []).length;
    expect(delimiterCount).toBe(4);
  });

  it('codepoint-safe truncates the summary to 200 chars', () => {
    // 1-codepoint emoji repeated; truncation must NOT split a surrogate pair.
    const emoji = '\u{1F600}'; // 😀 = 2 UTF-16 code units, 1 codepoint
    const summary = emoji.repeat(220); // 220 codepoints, 440 UTF-16 code units
    const line = formatCatalogLine({ ...baseInput, summary });
    // Strip the trailing newline, split by " | ", take the last field.
    const parts = line.replace(/\n$/, '').split(' | ');
    const summaryField = parts[parts.length - 1] ?? '';
    // Count codepoints (Array.from splits by codepoint, not by UTF-16 unit).
    const codepointCount = Array.from(summaryField).length;
    expect(codepointCount).toBeLessThanOrEqual(200);
    // No lone surrogate.
    for (const ch of summaryField) {
      expect(ch).toBe(emoji);
    }
  });

  it('appends a line atomically to Paths.data() + "/CATALOG.md"', async () => {
    const controller = new AbortController();
    await appendCatalogLine(baseInput, controller.signal);
    const contents = await fsp.readFile(catalogPath(), 'utf8');
    expect(contents).toBe(
      'doc-aaaaaaaa | Hello World | engineering | reference | A short summary about the document body.\n',
    );
  });

  it('appends multiple distinct doc_ids on subsequent calls', async () => {
    const controller = new AbortController();
    await appendCatalogLine(baseInput, controller.signal);
    await appendCatalogLine(
      { ...baseInput, doc_id: 'doc-bbbbbbbb', title: 'Second' },
      controller.signal,
    );
    const contents = await fsp.readFile(catalogPath(), 'utf8');
    const lines = contents.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('doc-aaaaaaaa');
    expect(lines[1]).toContain('doc-bbbbbbbb');
  });

  it('is idempotent on duplicate doc_id (skips if doc_id line exists)', async () => {
    const controller = new AbortController();
    await appendCatalogLine(baseInput, controller.signal);
    // Second call with the same doc_id — must not duplicate the line.
    await appendCatalogLine(baseInput, controller.signal);
    const contents = await fsp.readFile(catalogPath(), 'utf8');
    const lines = contents.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
  });
});
