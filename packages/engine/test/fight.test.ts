import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { fightScore, newGame, resolveFight } from '@lml/engine';
import type { ChampionState, GameState } from '@lml/engine/contracts';

const d = loadGameData();
const W = d.rules.fight;
const get = (s: GameState, side: string, role: string): ChampionState =>
  s.champions.find((c) => c.side === side && c.role === role)!;
function fresh(): GameState {
  const s = newGame(d, 7);
  for (const c of s.champions) {
    c.xp = 0; c.items = 0; c.bonusLead = 0;
  }
  return s;
}

describe('resolveFight', () => {
  test('2v1 at stage 0 beats a 3000 lead', () => {
    const s = fresh();
    const b1 = get(s, 'blue', 'top'), b2 = get(s, 'blue', 'jungle'), r = get(s, 'red', 'top');
    r.xp = 3000;
    const res = resolveFight(s, d, 'top-lane', [b1.id, b2.id], [r.id], 0);
    expect(res.winner).toBe('blue');
  });

  test('mirrored 1v1 with equal lead is a tie', () => {
    const s = fresh();
    const b = get(s, 'blue', 'top'), r = get(s, 'red', 'top');
    const orig = d.champions[r.id]!;
    d.champions[r.id] = { ...d.champions[b.id]!, id: r.id };
    try {
      expect(resolveFight(s, d, 'top-lane', [b.id], [r.id], 1).winner).toBeNull();
    } finally {
      d.champions[r.id] = orig;
    }
  });

  test('1v1 with +2000 lead wins', () => {
    const s = fresh();
    const b = get(s, 'blue', 'top'), r = get(s, 'red', 'top');
    b.xp = 2000;
    expect(resolveFight(s, d, 'top-lane', [b.id], [r.id], 1).winner).toBe('blue');
  });

  test('tower adds numbers and strength for its owner only while standing', () => {
    const s = fresh();
    const b = get(s, 'blue', 'top'), r = get(s, 'red', 'top');
    const pos = 'top-t1-red';
    const stage = 1;
    s.towers[pos] = 1;
    const withT = resolveFight(s, d, pos, [b.id], [r.id], stage).scores;
    const noT = fightScore(s, d, 'red', [r.id], [b.id], stage, null);
    expect(withT.red - noT).toBeCloseTo(W.towerNumbersFactor * W.numbers[stage] + W.strength * 0.3, 9);
    s.towers[pos] = 0;
    expect(resolveFight(s, d, pos, [b.id], [r.id], stage).scores.red).toBeCloseTo(noT, 9);
  });

  test('4v3 uses teamfight ratings, 3v3 skirmish', () => {
    const s = fresh();
    const bl = ['top', 'jungle', 'mid', 'adc'].map((r) => get(s, 'blue', r));
    const rd = ['top', 'jungle', 'mid'].map((r) => get(s, 'red', r));
    const c = d.champions[bl[0]!.id]!;
    const ids = bl.map((x) => x.id);
    const rids = rd.map((x) => x.id);
    const sa = c.skirmish!, ta = c.teamfight!;
    const sk = sa[0], tf = ta[0];
    const base4 = fightScore(s, d, 'blue', ids, rids, 0, null);
    const base3 = fightScore(s, d, 'blue', ids.slice(0, 3), rids, 0, null);
    ta[0] = tf + 1;
    expect(fightScore(s, d, 'blue', ids, rids, 0, null) - base4).toBeCloseTo(W.strength / 10, 9);
    expect(fightScore(s, d, 'blue', ids.slice(0, 3), rids, 0, null)).toBeCloseTo(base3, 9);
    ta[0] = tf;
    sa[0] = sk + 1;
    expect(fightScore(s, d, 'blue', ids, rids, 0, null)).toBeCloseTo(base4, 9);
    expect(fightScore(s, d, 'blue', ids.slice(0, 3), rids, 0, null) - base3).toBeCloseTo(W.strength / 10, 9);
    sa[0] = sk;
  });
});
