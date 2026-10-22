import { describe, expect, test } from 'bun:test';
import { shownRound } from '../src/components/format';

describe('shownRound', () => {
  test('is the round being played while ordering', () => {
    expect(shownRound('orders', 5)).toBe(5);
    expect(shownRound('contacts', 5)).toBe(5);
  });

  test('is the round just played in review and once the game is over', () => {
    expect(shownRound('review', 6)).toBe(5);
    expect(shownRound('over', 72)).toBe(71);
  });
});
