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
  test('jungle: a known camp is kept; an unknown one or none leaves the seed to pick', () => {
    const camps = ['gromp-blue', 'bluebuff-blue'];
    expect(parseAutostart('?autostart=1&seed=7&jungle=gromp-blue', ranks, () => 1, camps)).toEqual({ rank: 'gold', seed: 7, junglerStart: 'gromp-blue' });
    expect(parseAutostart('?autostart=1&seed=7&jungle=krugs-red', ranks, () => 1, camps)).toEqual({ rank: 'gold', seed: 7 });
    expect(parseAutostart('?autostart=1&seed=7', ranks, () => 1, camps)).toEqual({ rank: 'gold', seed: 7 });
  });
});
