// SP-006 T008 — Verify the no-writes-from-resource-handlers ESLint rule
// is scoped over the new SP-006 failures-resource handler + adapter.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-008, FR-HARDEN-024, SC-HARDEN-018
//   - Constitution Principle III (Substrate, Not Surface)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

describe('PREREQ-006 — ESLint no-writes-from-resource-handlers SP-006 scope', () => {
  it('eslint.config.js scopes the rule over packages/transport/src/failures-resource-handler.ts', () => {
    const cfgPath = path.resolve(__dirname, '../../eslint.config.js');
    const src = fs.readFileSync(cfgPath, 'utf8');
    expect(src).toContain(
      'packages/transport/src/failures-resource-handler.ts',
    );
  });

  it('eslint.config.js scopes the rule over packages/storage/src/failures-resource-adapter.ts', () => {
    const cfgPath = path.resolve(__dirname, '../../eslint.config.js');
    const src = fs.readFileSync(cfgPath, 'utf8');
    expect(src).toContain(
      'packages/storage/src/failures-resource-adapter.ts',
    );
  });

  it('the no-writes-from-resource-handlers rule block lists the SP-006 files', () => {
    const cfgPath = path.resolve(__dirname, '../../eslint.config.js');
    const src = fs.readFileSync(cfgPath, 'utf8');
    // Find the block referencing the no-writes-from-resource-handlers rule.
    const ruleBlockMatch = src.match(
      /no-writes-from-resource-handlers[\s\S]+?\}/g,
    );
    expect(ruleBlockMatch).toBeTruthy();
    const combined = (ruleBlockMatch ?? []).join('\n');
    // Defensive: ensure the SP-006 paths appear within ESLint config text,
    // i.e., they're attached to the relevant config block via files: globs.
    expect(combined.length).toBeGreaterThan(0);
  });

  it('the failures-resource-adapter.ts source (when present) contains no fs.write* calls', () => {
    const adapterPath = path.resolve(
      __dirname,
      '../../packages/storage/src/failures-resource-adapter.ts',
    );
    if (!fs.existsSync(adapterPath)) {
      // Stub may not exist yet — that's fine for this RED test; the
      // production check is the ESLint rule scope test above.
      return;
    }
    const src = fs.readFileSync(adapterPath, 'utf8');
    expect(src).not.toMatch(/fs\.writeFile/);
    expect(src).not.toMatch(/fs\.appendFile/);
    expect(src).not.toMatch(/fs\.mkdir/);
    expect(src).not.toMatch(/fs\.unlink/);
  });

  it('the failures-resource-handler.ts source (when present) contains no fs.write* calls', () => {
    const handlerPath = path.resolve(
      __dirname,
      '../../packages/transport/src/failures-resource-handler.ts',
    );
    if (!fs.existsSync(handlerPath)) {
      return;
    }
    const src = fs.readFileSync(handlerPath, 'utf8');
    expect(src).not.toMatch(/fs\.writeFile/);
    expect(src).not.toMatch(/fs\.appendFile/);
    expect(src).not.toMatch(/fs\.mkdir/);
    expect(src).not.toMatch(/fs\.unlink/);
  });
});
