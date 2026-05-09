// T016 — Unit test: parseYaml / stringifyYaml (Constitution V — single YAML lib).
//
// References: plan.md R5 ("publish yaml helper from contracts").
// The contracts package owns the canonical YAML helper so storage/transport
// inherit it. Hand-rolled YAML or alternate libraries are forbidden.

import { describe, it, expect } from 'vitest';
import {
  parseYaml,
  stringifyYaml,
} from '../../packages/contracts/src/yaml.js';

describe('parseYaml() (T016)', () => {
  it('parses a simple mapping', () => {
    const out = parseYaml('a: 1\nb: two\n');
    expect(out).toEqual({ a: 1, b: 'two' });
  });

  it('parses nested structures', () => {
    const out = parseYaml(`
list:
  - 1
  - 2
nested:
  deep:
    x: y
`);
    expect((out as { list: number[] }).list).toEqual([1, 2]);
    expect(((out as { nested: { deep: { x: string } } }).nested.deep.x)).toBe(
      'y',
    );
  });

  it('returns undefined for empty input (canonical js-yaml behavior)', () => {
    // js-yaml's load('') returns undefined; this is the documented behavior.
    expect(parseYaml('')).toBeUndefined();
  });

  it('rejects multi-document streams (loadAll forbidden)', () => {
    const multi = `---
a: 1
---
b: 2
`;
    expect(() => parseYaml(multi)).toThrow();
  });

  it('throws on malformed YAML', () => {
    expect(() => parseYaml('a: : :')).toThrow();
  });
});

describe('stringifyYaml() (T016)', () => {
  it('emits a stable round-trippable YAML', () => {
    const obj = { b: 2, a: 1, c: { x: 'y' } };
    const out = stringifyYaml(obj);
    const parsed = parseYaml(out);
    expect(parsed).toEqual(obj);
  });

  it('emits stable key order (sortKeys default — deterministic snapshots)', () => {
    const a = stringifyYaml({ b: 2, a: 1 });
    const b = stringifyYaml({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('round-trip preserves canonical inputs', () => {
    const obj = {
      id: 'doc-ab12cd34',
      tags: ['a', 'b', 'c'],
      nested: { value: 42 },
    };
    const yaml = stringifyYaml(obj);
    const back = parseYaml(yaml);
    expect(back).toEqual(obj);
  });
});
