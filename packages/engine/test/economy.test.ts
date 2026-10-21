import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import {
  advanceRespawns, aiContactChoice, aiOrders, applyKill, createRng, detectContacts, resolveRound, viewFor, completeRecall, finishIfOver, level, newGame, teamScore, totalRounds,
} from '@lml/engine';
import type { ContactChoices, GameEvent, GameState, Orders } from '@lml/engine/contracts';

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
    advanceRespawns(s, d);
    expect(v.status).toBe('respawning');
  });
  test('a victim spends its unspent gold on items before dying', () => {
    const s = fresh(10);
    const v = id(s, 'red', 'top');
    v.gold = 900;
    v.items = 400;
    const earned = v.goldEarned;
    applyKill(s, d, [v.id], [id(s, 'blue', 'top').id], []);
    expect(v.items).toBe(1300);
    expect(v.gold).toBe(0);
    expect(v.goldEarned).toBe(earned);
    expect(v.status).toBe('dead');
  });
  test('a respawn restores full health', () => {
    const s = fresh(10);
    const v = id(s, 'red', 'top');
    v.hp = 15;
    applyKill(s, d, [v.id], [id(s, 'blue', 'top').id], []);
    s.round = 11;
    advanceRespawns(s, d);
    expect(v.hp).toBe(d.rules.health.max);
  });
});

describe('recall', () => {
  test('banks gold into items', () => {
    const s = fresh(5);
    const c = id(s, 'blue', 'adc');
    const items = c.items;
    c.gold = 1200;
    const ev: GameEvent[] = [];
    completeRecall(s, d, c, ev);
    expect(c.items).toBe(items + 1200);
    expect(c.gold).toBe(0);
    expect(c.status).toBe('respawning');
    expect(c.respawnRound).toBe(6);
    expect(ev[0]).toEqual({ type: 'recall', champion: c.id, itemsBought: 1200 });
  });
  test('restores full health', () => {
    const s = fresh(5);
    const c = id(s, 'blue', 'adc');
    c.hp = 30;
    completeRecall(s, d, c, []);
    expect(c.hp).toBe(d.rules.health.max);
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

describe('kills counter', () => {
  test('a new game has no kills', () => {
    expect(newGame(d, 7).kills).toEqual({ blue: 0, red: 0 });
  });
  test('the winners side scores once per victim', () => {
    const s = fresh(10);
    applyKill(s, d, [id(s, 'red', 'top').id, id(s, 'red', 'mid').id], [id(s, 'blue', 'top').id], []);
    expect(s.kills).toEqual({ blue: 2, red: 0 });
  });
  test('over a whole AI game, kills match the death events', () => {
    const p = d.aiProfiles.find((x) => x.rank === 'gold')!;
    const rng = createRng(3);
    let s = newGame(d, 3);
    const deaths = { blue: 0, red: 0 };
    while (!s.over) {
      const views = { blue: viewFor(s, d, 'blue'), red: viewFor(s, d, 'red') };
      const orders: Orders = { blue: aiOrders(views.blue, d, p, rng), red: aiOrders(views.red, d, p, rng) };
      const choices: ContactChoices = {};
      for (const c of detectContacts(s, d, orders)) {
        choices[c.id] = { blue: aiContactChoice(views.blue, d, c, p, rng), red: aiContactChoice(views.red, d, c, p, rng) };
      }
      const r = resolveRound(s, d, orders, choices);
      for (const e of r.events) {
        if (e.type !== 'death') continue;
        const victim = r.state.champions.find((c) => c.id === e.champion)!;
        deaths[victim.side === 'blue' ? 'red' : 'blue'] += 1;
      }
      s = r.state;
    }
    expect(deaths.blue + deaths.red).toBeGreaterThan(0);
    expect(s.kills).toEqual(deaths);
  });
});
