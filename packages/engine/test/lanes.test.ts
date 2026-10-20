import { describe, expect, test } from 'bun:test';
import { loadGameData, matchupAdvantage } from '@lml/data';
import type { Lane, Side } from '@lml/data/contracts';
import { frontTower, newGame, roundWindow, updateLanes } from '@lml/engine';
import type { ChampionState, GameEvent, GameState } from '@lml/engine/contracts';

const d = loadGameData();
const get = (s: GameState, side: Side, role: string): ChampionState =>
  s.champions.find((c) => c.side === side && c.role === role)!;
function fresh(round = 1): GameState {
  const s = newGame(d, 7);
  s.round = round;
  for (const c of s.champions) {
    c.xp = 0; c.items = 0; c.bonusLead = 0; c.gold = 0; c.goldEarned = 0; c.position = 'blue-base';
  }
  return s;
}
const run = (s: GameState, tw: Partial<Record<Lane, Side | null>> = {}): GameEvent[] => {
  const ev: GameEvent[] = [];
  updateLanes(s, d, tw, ev);
  return ev;
};
/** Puts three blue champions on the red T1 with the top wave already pushed. */
function push3(round = 1): GameState {
  const s = fresh(round);
  for (const r of ['top', 'jungle', 'mid']) get(s, 'blue', r).position = 'top-t1-red';
  s.waves.top = 1;
  return s;
}

describe('waves', () => {
  test('lone blue laner moves the wave toward red', () => {
    const s = fresh();
    get(s, 'blue', 'top').position = 'top-lane';
    run(s);
    expect(s.waves.top).toBe(1);
  });
  test('even 1v1 moves the wave toward the trade loser', () => {
    const s = fresh();
    get(s, 'blue', 'top').position = 'top-lane';
    get(s, 'red', 'top').position = 'top-lane';
    const ev = run(s, { top: 'blue' });
    expect(s.waves.top).toBe(1);
    expect(ev).toContainEqual({ type: 'wave', lane: 'top', from: 0, to: 1 });
    expect(get(s, 'blue', 'top').bonusLead).toBe(d.rules.economy.tradeLead);
    expect(get(s, 'red', 'top').bonusLead).toBe(0);
  });
  test('empty lane drifts back to the middle', () => {
    const s = fresh();
    Object.assign(s.waves, { mid: -1 });
    run(s);
    expect(s.waves.mid).toBe(0);
  });
});

describe('towers', () => {
  test('3 attackers remove pushDamage[2]; grubs and baron multiply', () => {
    const s = push3();
    const ev = run(s);
    expect(s.towers['top-t1-red']).toBe(3);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'towerDamage', tower: 'top-t1-red', hp: 3, destroyed: false }));
    expect(s.platesTaken.blue).toBe(2);

    const g = push3();
    g.grubs.blue = true;
    run(g);
    expect(g.towers['top-t1-red']).toBe(2);

    const b = push3();
    b.grubs.blue = true;
    b.baronUntilRound.blue = b.round;
    const bev = run(b);
    expect(b.towers['top-t1-red']).toBeLessThanOrEqual(0);
    expect(bev).toContainEqual(expect.objectContaining({ type: 'towerDamage', destroyed: true }));
    expect(b.towersDestroyed.blue).toBe(1);
    expect(frontTower(b, d, 'red', 'top')).toBe('top-t2-red');
  });
  /** Gold a pusher earns from farm + passive in `round`, with 3 non-support pushers. */
  const base = (round: number): number => {
    const sec = roundWindow(d.rules, round).seconds;
    return (d.rules.economy.farmGoldPerMin * sec) / 60 / 3 + (d.rules.economy.passiveGoldPerMin * sec) / 60;
  };
  test('plate gold is split among attackers before 14:00', () => {
    const s = push3(1);
    run(s);
    expect(get(s, 'blue', 'top').goldEarned).toBeCloseTo(base(1) + (d.rules.towers.plateGold * 2) / 3, 6);
    expect(get(s, 'blue', 'top').gold).toBeCloseTo(get(s, 'blue', 'top').goldEarned, 6);
  });
  test('plates give no gold after 14:00', () => {
    const s = push3(30);
    run(s);
    expect(s.platesTaken.blue).toBe(2);
    expect(get(s, 'blue', 'top').goldEarned).toBeCloseTo(base(30), 6);
  });
  test('defender on the tower blocks damage', () => {
    const s = push3();
    get(s, 'red', 'top').position = 'top-t1-red';
    run(s);
    expect(s.towers['top-t1-red']).toBe(5);
  });
});

describe('farming', () => {
  test('adc and support alone in bot for 20s', () => {
    const s = fresh();
    get(s, 'blue', 'adc').position = 'bot-lane';
    get(s, 'blue', 'support').position = 'bot-lane';
    run(s);
    const passive = (d.rules.economy.passiveGoldPerMin * 20) / 60;
    expect(get(s, 'blue', 'adc').gold - passive).toBeCloseTo(110, 6);
    expect(get(s, 'blue', 'support').gold - passive).toBeCloseTo(33, 6);
    expect(get(s, 'blue', 'adc').goldEarned).toBeCloseTo(110 + passive, 6);
    expect(get(s, 'blue', 'adc').xp).toBeCloseTo((d.rules.economy.farmXpPerMin * 20) / 60, 6);
  });
});

describe('absent laner chip', () => {
  test('pressure over an absent laner chips the front tower once', () => {
    const s = fresh();
    s.waves.top = 1;
    get(s, 'blue', 'top').position = 'top-lane';
    const a = get(s, 'blue', 'top'), r = get(s, 'red', 'top');
    const adv = matchupAdvantage(d, a.id, r.id, roundWindow(d.rules, 1).stage);
    run(s);
    expect(s.towers['top-t1-red']).toBe(adv !== null && adv > 0 ? 5 - d.rules.towers.absentLanerChip : 5);
  });
});
