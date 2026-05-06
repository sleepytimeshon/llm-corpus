// T012 — Unit test for Result<T, E> (Constitution XI — Library/CLI Boundary).
// Tests construction, unwrap behavior, map/flatMap, type narrowing.

import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, type Result } from '../../packages/contracts/src/result.js';

describe('Result<T, E> (Constitution XI)', () => {
  describe('construction', () => {
    it('ok(value) returns a success Result', () => {
      const r = ok(42);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(42);
    });

    it('err(error) returns a failure Result', () => {
      const r = err('oops');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('oops');
    });
  });

  describe('isOk / isErr type guards', () => {
    it('isOk narrows to success branch', () => {
      const r: Result<number, string> = ok(7);
      if (isOk(r)) {
        // TS should narrow r.value to number
        const n: number = r.value;
        expect(n).toBe(7);
      } else {
        throw new Error('isOk should be true');
      }
    });

    it('isErr narrows to error branch', () => {
      const r: Result<number, string> = err('bad');
      if (isErr(r)) {
        const e: string = r.error;
        expect(e).toBe('bad');
      } else {
        throw new Error('isErr should be true');
      }
    });
  });

  describe('map', () => {
    it('map applies fn to value when ok', async () => {
      const { map } = await import('../../packages/contracts/src/result.js');
      const r = map(ok(5), (n) => n * 2);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(10);
    });

    it('map passes through error unchanged', async () => {
      const { map } = await import('../../packages/contracts/src/result.js');
      const r: Result<number, string> = err('fail');
      const mapped = map(r, (n) => n * 2);
      expect(mapped.ok).toBe(false);
      if (!mapped.ok) expect(mapped.error).toBe('fail');
    });
  });

  describe('flatMap', () => {
    it('flatMap chains ok → ok', async () => {
      const { flatMap } = await import('../../packages/contracts/src/result.js');
      const r = flatMap(ok(3), (n) => ok(n + 1));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(4);
    });

    it('flatMap chains ok → err', async () => {
      const { flatMap } = await import('../../packages/contracts/src/result.js');
      const r = flatMap(ok(3), (_n) => err<string>('inner-fail'));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('inner-fail');
    });

    it('flatMap on err passes through', async () => {
      const { flatMap } = await import('../../packages/contracts/src/result.js');
      const r: Result<number, string> = err('outer-fail');
      const chained = flatMap(r, (n) => ok(n + 1));
      expect(chained.ok).toBe(false);
      if (!chained.ok) expect(chained.error).toBe('outer-fail');
    });
  });

  describe('unwrapOr', () => {
    it('unwrapOr returns value when ok', async () => {
      const { unwrapOr } = await import('../../packages/contracts/src/result.js');
      expect(unwrapOr(ok(99), 0)).toBe(99);
    });

    it('unwrapOr returns default when err', async () => {
      const { unwrapOr } = await import('../../packages/contracts/src/result.js');
      expect(unwrapOr(err('fail'), 42)).toBe(42);
    });
  });
});
