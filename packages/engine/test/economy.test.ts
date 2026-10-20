import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import {
  advanceRespawns, applyKill, completeRecall, finishIfOver, level, newGame, teamScore, totalRounds,
} from '@lml/engine';
import type { GameEvent, GameState } from '@lml/engine/contracts';

const d = loadGameData();
const fresh = (round: number): GameState => {
  const s = newGame(d, 7);
  s.round = round;
  return s;
};
const id = (s: GameState, side: 'blue' | 'red', role: string) =>
  s.champions.find((c) => c.side === side && c.role === role)!;

describe('level', () => {
  test('thresholds', () => {
    expect(level(0, d.rules)).toBe(1);
    expect(level(279, d.rules)).toBe(1);
    expect(level(280, d.rules)).toBe(2);
    expect(level(18360, d.rules)).toBe(18);
  });
});

describe('death', () => {
  test('round 10 death respawns round 11', () => {
    const s = fresh(10);
    const v = id(s, 'red', 'top');
    const ev: GameEvent[] = [];
    applyKill(s, d, [v.id], [id(s, 'blue', 'top').id], ev);
    expect(v.status).toBe('dead');
    expect(v.respawnRound).toBe(11);
    expect(ev[0]).toMatchObject({ type: 'death', champion: v.id, respawnRound: 11 });
  });
  test('round 33 (stage 4) death respawns round 35', () => {
    const s = fresh(33);
    const v = id(s, 'red', 'top');
    applyKill(s, d, [v.id], [id(s, 'blue', 'top').id], []);
    expect(v.respawnRound).toBe(35);
  });
  test('winners split gold and xp per victim; herald is lost', () => {
    const s = fresh(10);
    const v = id(s, 'red', 'top');
    v.hasHerald = true;
    const a = id(s, 'blue', 'top');
    const b = id(s, 'blue', 'mid');
    const g = a.gold;
    b.goldEarned = 0;
    applyKill(s, d, [v.id], [a.id, b.id], []);
    expect(v.hasHerald).toBe(false);
    expect(a.gold - g).toBe(d.rules.economy.killGold / 2);
    expect(b.goldEarned).toBe(d.rules.economy.killGold / 2);
  });
  test('dead champion respawns when the round arrives', () => {
    const s = fresh(10);
    const v = id(s, 'red', 'top');
    applyKill(s, d, [v.id], [id(s, 'blue', 'top').id], []);
    s.round = 11;
    advanceRespawns(s);
    expect(v.status).toBe('respawning');
  });
});

describe('recall', () => {
  test('banks gold into items', () => {
    const s = fresh(5);
    const c = id(s, 'blue', 'adc');
    const items = c.items;
    c.gold = 1200;
    const ev: GameEvent[] = [];
    completeRecall(s, c, ev);
    expect(c.items).toBe(items + 1200);
    expect(c.gold).toBe(0);
    expect(c.status).toBe('respawning');
    expect(c.respawnRound).toBe(6);
    expect(ev[0]).toEqual({ type: 'recall', champion: c.id, itemsBought: 1200 });
  });
});

describe('verdict', () => {
  test('no-op before the last round is over', () => {
    const s = fresh(totalRounds(d.rules));
    finishIfOver(s, d);
    expect(s.over).toBe(false);
    expect(s.winner).toBeNull();
  });
  test('equal scores draw', () => {
    const s = fresh(totalRounds(d.rules) + 1);
    for (const c of s.champions) c.goldEarned = 0;
    finishIfOver(s, d);
    expect(s.over).toBe(true);
    expect(s.winner).toBe('draw');
  });
  test('higher score wins and counts plates and towers', () => {
    const s = fresh(totalRounds(d.rules) + 1);
    for (const c of s.champions) c.goldEarned = 0;
    s.platesTaken.red = 2;
    s.towersDestroyed.blue = 1;
    expect(teamScore(s, d, 'red')).toBe(2 * d.rules.verdict.plateValue);
    finishIfOver(s, d);
    expect(s.winner).toBe(2 * d.rules.verdict.plateValue > d.rules.verdict.towerValue ? 'red' : 'blue');
  });
});
