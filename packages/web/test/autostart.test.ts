import { describe, expect, test } from 'bun:test';
import type { Rank } from '@lml/data/contracts';
import { parseAutostart } from '../src/autostart';

const ranks = ['iron', 'gold'] as Rank[];

describe('parseAutostart', () => {
  test('null without autostart=1', () => {
    expect(parseAutostart('?rank=iron', ranks)).toBeNull();
  });
  test('valid input', () => {
    expect(parseAutostart('?autostart=1&rank=iron&seed=7', ranks)).toEqual({ rank: 'iron', seed: 7 });
  });
  test('bad rank falls back to gold', () => {
    expect(parseAutostart('?autostart=1&rank=foo&seed=7', ranks)?.rank).toBe('gold');
  });
  test('bad or missing seed falls back to a random one', () => {
    for (const q of ['?autostart=1&seed=abc', '?autostart=1&seed=1.5', '?autostart=1&seed=', '?autostart=1']) {
      expect(parseAutostart(q, ranks, () => 99)?.seed).toBe(99);
    }
  });
  test('no jungle= param any more: round 0 places the jungler, a stray jungle= is ignored', () => {
    expect(parseAutostart('?autostart=1&seed=7&jungle=gromp-blue', ranks, () => 1)).toEqual({ rank: 'gold', seed: 7 });
    expect(parseAutostart('?autostart=1&seed=7', ranks, () => 1)).toEqual({ rank: 'gold', seed: 7 });
  });
});
