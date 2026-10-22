import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { defaultOrders, estimateEnemy, fightScore, newGame, resolveRound, viewFor } from '@lml/engine';
import type { ChampionState, GameState, Order, Orders } from '@lml/engine/contracts';

const d = loadGameData();
const H = d.rules.health;
const get = (s: GameState, side: string, role: string): ChampionState =>
  s.champions.find((c) => c.side === side && c.role === role)!;
const place = (s: GameState, side: string, role: string, pos: string): void => {
  const c = get(s, side, role);
  c.position = pos;
  c.previous = pos;
};
const ordersWith = (s: GameState, over: Order[] = []): Orders => {
  const f = (side: 'blue' | 'red'): Order[] =>
    defaultOrders(s, d, side).map((o) => over.find((x) => x.champion === o.champion) ?? o);
  return { blue: f('blue'), red: f('red') };
};

/** Tops meeting on top-lane at round 10, blue far ahead. */
function lane(): GameState {
  const s = newGame(d, 7);
  s.round = 10;
  place(s, 'blue', 'top', 'top-lane');
  place(s, 'red', 'top', 'top-lane');
  s.waves.top = 0;
  get(s, 'blue', 'top').bonusLead += 100_000;
  return s;
}

describe('health', () => {
  test('every champion starts at full health', () => {
    expect(newGame(d, 7).champions.every((c) => c.hp === H.max)).toBe(true);
  });

  test('a lost trade costs tradeLoss, a won one tradeWinnerLoss; only champions who lost no HP regenerate', () => {
    const s = lane();
    get(s, 'blue', 'top').hp = 50;
    get(s, 'red', 'top').hp = 60;
    const rt = get(s, 'red', 'top').id;
    const { state } = resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: rt, to: 'top-lane', stance: 'trade' }]), {});
    expect(get(state, 'blue', 'top').hp).toBe(50 - H.tradeWinnerLoss);
    expect(get(state, 'red', 'top').hp).toBe(60 - H.tradeLoss);
    expect(get(state, 'blue', 'mid').hp).toBe(H.max);
    get(s, 'blue', 'mid').hp = 50;
    const unhurt = resolveRound(s, d, ordersWith(s), {}).state;
    expect(get(unhurt, 'blue', 'mid').hp).toBe(50 + H.regenPerRound);
  });

  test('a tied trade costs no HP', () => {
    const s = lane();
    const bt = get(s, 'blue', 'top');
    const rt = get(s, 'red', 'top');
    bt.bonusLead = 0;
    bt.hp = 50;
    rt.hp = 50;
    const orig = d.champions[rt.id]!;
    d.champions[rt.id] = { ...d.champions[bt.id]!, id: rt.id };
    try {
      const o = ordersWith(s, [
        { kind: 'move', champion: bt.id, to: 'top-lane', stance: 'trade' },
        { kind: 'move', champion: rt.id, to: 'top-lane', stance: 'trade' },
      ]);
      const { state, events } = resolveRound(s, d, o, {});
      expect(events).toContainEqual({ type: 'trade', position: 'top-lane', lane: 'top', winner: null });
      expect(get(state, 'blue', 'top').hp).toBe(50 + H.regenPerRound);
      expect(get(state, 'red', 'top').hp).toBe(50 + H.regenPerRound);
    } finally {
      d.champions[rt.id] = orig;
    }
  });

  test('fleeing a committed gank down to 0 HP dies, the kill goes to the side that stayed', () => {
    const s = newGame(d, 7);
    s.round = 10;
    place(s, 'blue', 'top', 'top-t1-blue');
    place(s, 'red', 'top', 'top-t1-red');
    place(s, 'red', 'jungle', 'scuttle-top');
    get(s, 'blue', 'top').hp = d.rules.fight.gankHpLoss;
    const bt = get(s, 'blue', 'top').id;
    const o = ordersWith(s, [
      { kind: 'move', champion: bt, to: 'top-lane' },
      { kind: 'move', champion: get(s, 'red', 'top').id, to: 'top-lane' },
      { kind: 'move', champion: get(s, 'red', 'jungle').id, to: 'top-lane' },
    ]);
    const { state, events } = resolveRound(s, d, o, {});
    expect(get(state, 'blue', 'top').status).not.toBe('alive');
    expect(events.filter((e) => e.type === 'death').map((e) => e.champion)).toEqual([bt]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'death', champion: bt, position: 'top-lane' }));
    expect(state.kills.red).toBe(1);
  });

  test('a trade won because the other side fled costs no trade HP; fleeing a committed gank costs gankHpLoss', () => {
    const s = newGame(d, 7);
    s.round = 10;
    place(s, 'blue', 'top', 'top-t1-blue');
    place(s, 'red', 'top', 'top-t1-red');
    place(s, 'red', 'jungle', 'scuttle-top');
    for (const c of s.champions) c.hp = 50 + d.rules.fight.gankHpLoss;
    const bt = get(s, 'blue', 'top').id;
    const o = ordersWith(s, [
      { kind: 'move', champion: bt, to: 'top-lane' },
      { kind: 'move', champion: get(s, 'red', 'top').id, to: 'top-lane' },
      { kind: 'move', champion: get(s, 'red', 'jungle').id, to: 'top-lane' },
    ]);
    const { state, events } = resolveRound(s, d, o, {});
    expect(events).toContainEqual({ type: 'fled', champion: bt, to: 'top-t1-blue' });
    expect(events.some((e) => e.type === 'trade' && e.winner === 'red')).toBe(true);
    for (const role of ['top', 'jungle']) expect(get(state, 'red', role).hp).toBe(Math.min(H.max, 50 + d.rules.fight.gankHpLoss + H.regenPerRound));
    expect(get(state, 'blue', 'top').hp).toBe(50);
    expect(events).toContainEqual({ type: 'hpLost', champion: bt, amount: d.rules.fight.gankHpLoss });
  });

  test('health is clamped to 0..max; reaching 0 kills, credited to the contact opponents, with a respawn timer', () => {
    const s = lane();
    get(s, 'red', 'top').hp = 5;
    const rt = get(s, 'red', 'top').id;
    const bt = get(s, 'blue', 'top');
    const goldBefore = bt.gold;
    const { state, events } = resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: rt, to: 'top-lane', stance: 'trade' }]), {});
    const red = get(state, 'red', 'top');
    expect(red.status).not.toBe('alive');
    expect(red.respawnRound).toBeGreaterThan(s.round);
    expect(events).toContainEqual({ type: 'hpLost', champion: rt, amount: 5 });
    expect(events.filter((e) => e.type === 'death').map((e) => e.champion)).toEqual([rt]);
    expect(state.kills.blue).toBe(1);
    expect(get(state, 'blue', 'top').goldEarned).toBeGreaterThan(bt.goldEarned);
    expect(get(state, 'blue', 'top').gold).toBeGreaterThan(goldBefore);
    get(s, 'blue', 'mid').hp = H.max - 1;
    const r2 = resolveRound(s, d, ordersWith(s), {});
    expect(get(r2.state, 'blue', 'mid').hp).toBe(H.max);
  });

  test('a recall completed in a round restores full health', () => {
    const s = lane();
    const bm = get(s, 'blue', 'mid');
    bm.hp = 20;
    const { state } = resolveRound(s, d, ordersWith(s, [{ kind: 'recall', champion: bm.id }]), {});
    expect(get(state, 'blue', 'mid').hp).toBe(H.max);
  });

  test('a wounded champion weighs less in a fight score', () => {
    const s = lane();
    const bt = get(s, 'blue', 'top');
    const rt = get(s, 'red', 'top');
    const full = fightScore(s, d, 'blue', [bt.id], [rt.id], 1, null);
    bt.hp = 40;
    const hurt = fightScore(s, d, 'blue', [bt.id], [rt.id], 1, null);
    expect(hurt).toBeCloseTo(full * (1 - H.fightWeight * (1 - 40 / H.max)), 9);
  });

  test('enemy HP shows only while the enemy is visible; the estimate takes an unseen enemy at full HP', () => {
    const s = newGame(d, 5);
    s.round = 4;
    place(s, 'red', 'top', 'top-t2-red');
    place(s, 'red', 'jungle', 'gromp-red');
    const after = resolveRound(s, d, ordersWith(s), {}).state;
    get(after, 'red', 'top').hp = 30;
    get(after, 'red', 'jungle').hp = 40;
    const view = viewFor(after, d, 'blue');
    const top = view.enemies.find((e) => e.id === get(s, 'red', 'top').id)!;
    const jg = view.enemies.find((e) => e.id === get(s, 'red', 'jungle').id)!;
    expect(top).toMatchObject({ visible: true, hp: 30 });
    expect(jg).toMatchObject({ visible: false, hp: null });
    expect(estimateEnemy(view, d, top).hp).toBe(30);
    expect(estimateEnemy(view, d, jg).hp).toBe(H.max);
    expect(view.allies.every((a) => typeof a.hp === 'number')).toBe(true);
  });
});
