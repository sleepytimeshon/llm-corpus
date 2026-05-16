// SP-007 T062 — RED-phase contract test for `parsePromoteArgs` (argv → Zod).
//
// References:
//   - specs/007-install-first-run/tasks.md T062
//   - specs/007-install-first-run/spec.md FR-INSTALL-014, SC-007-020
//   - specs/007-install-first-run/contracts/adr-taxonomy-promote-cli.md (ADR-014)
//   - Constitution V (schema-enforced)

import { describe, it, expect } from 'vitest';
import { parsePromoteArgs } from '../../packages/cli/src/install-helpers/taxonomy-promote-helpers.js';

describe('SP-007 T062 — parsePromoteArgs', () => {
  it('parses --axis=domain --term=climbing', () => {
    const r = parsePromoteArgs(['--axis=domain', '--term=climbing']);
    expect(r.axis).toBe('domain');
    expect(r.terms).toEqual(['climbing']);
    expect(r.from_proposed_with_count_ge).toBeUndefined();
  });

  it('parses repeated --term flags', () => {
    const r = parsePromoteArgs([
      '--axis=domain',
      '--term=climbing',
      '--term=skiing',
    ]);
    expect(r.axis).toBe('domain');
    expect(r.terms).toEqual(['climbing', 'skiing']);
  });

  it('parses --from-proposed-with-count-ge=10', () => {
    const r = parsePromoteArgs(['--from-proposed-with-count-ge=10']);
    expect(r.from_proposed_with_count_ge).toBe(10);
    expect(r.axis).toBeUndefined();
    expect(r.terms).toBeUndefined();
  });

  it('rejects mutually exclusive modes', () => {
    expect(() =>
      parsePromoteArgs([
        '--axis=domain',
        '--term=climbing',
        '--from-proposed-with-count-ge=3',
      ]),
    ).toThrow(/mutually exclusive/);
  });

  it('rejects invalid axis', () => {
    expect(() =>
      parsePromoteArgs(['--axis=not_a_real_axis', '--term=x']),
    ).toThrow();
  });

  it('rejects --axis without --term', () => {
    expect(() => parsePromoteArgs(['--axis=domain'])).toThrow();
  });

  it('rejects neither mode supplied', () => {
    expect(() => parsePromoteArgs([])).toThrow();
  });

  it('rejects negative --from-proposed-with-count-ge', () => {
    expect(() =>
      parsePromoteArgs(['--from-proposed-with-count-ge=-5']),
    ).toThrow();
  });

  it('rejects non-integer --from-proposed-with-count-ge', () => {
    expect(() =>
      parsePromoteArgs(['--from-proposed-with-count-ge=3.14']),
    ).toThrow();
  });

  it('accepts space-form --axis domain --term climbing', () => {
    const r = parsePromoteArgs(['--axis', 'domain', '--term', 'climbing']);
    expect(r.axis).toBe('domain');
    expect(r.terms).toEqual(['climbing']);
  });
});
