import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { defaultOrders, newGame, resolveRound, viewFor, visibleEnemies } from '@lml/engine';
import type { ChampionState, GameState, Order, Orders } from '@lml/engine/contracts';

const d = loadGameData();
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

describe('visibleEnemies', () => {
  test('an enemy anywhere in the lane of an ally is visible', () => {
    const s = newGame(d, 5);
    place(s, 'red', 'top', 'top-t2-red');
    place(s, 'red', 'jungle', 'gromp-red');
    const seen = visibleEnemies(s, d, 'blue');
    expect(seen).toContain(get(s, 'red', 'top').id);
    expect(seen).not.toContain(get(s, 'red', 'jungle').id);
  });

  test('a ward placed in round 3 reveals in round 4 only', () => {
    const s = newGame(d, 5);
    s.round = 3;
    place(s, 'blue', 'jungle', 'raptors-red');
    place(s, 'red', 'jungle', 'gromp-red');
    const bj = get(s, 'blue', 'jungle').id;
    const rj = get(s, 'red', 'jungle').id;
    const r3 = resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: bj, to: 'redbuff-red', ward: 'from' }]), {});
    expect(r3.state.wards).toContainEqual({ side: 'blue', position: 'raptors-red', placedRound: 3 });

    const s4 = r3.state;
    place(s4, 'red', 'jungle', 'raptors-red');
    expect(visibleEnemies(s4, d, 'blue')).toContain(rj);
    const r4 = resolveRound(s4, d, ordersWith(s4), {});
    expect(r4.state.lastSeen.blue[rj]).toEqual({ position: 'raptors-red', round: 4 });
    expect(r4.state.wards.some((w) => w.position === 'raptors-red')).toBe(false);

    expect(visibleEnemies(r4.state, d, 'blue')).not.toContain(rj);
    const r5 = resolveRound(r4.state, d, ordersWith(r4.state), {});
    expect(r5.state.lastSeen.blue[rj]).toEqual({ position: 'raptors-red', round: 4 });
    expect(viewFor(r5.state, d, 'blue').enemies.find((e) => e.id === rj)).toMatchObject({
      visible: false, position: 'raptors-red', lastSeenRound: 4, level: null,
    });
  });
});

describe('viewFor', () => {
  test('only enemies visible this round show their current position', () => {
    const s = newGame(d, 9);
    s.round = 4;
    place(s, 'red', 'top', 'top-t2-red');
    place(s, 'red', 'mid', 'wolves-red');
    place(s, 'red', 'jungle', 'raptors-red');
    s.lastSeen.blue[get(s, 'red', 'mid').id] = { position: 'mid-t1-red', round: 2 };
    s.wards.push({ side: 'blue', position: 'raptors-red', placedRound: 3 });
    s.wards.push({ side: 'red', position: 'raptors-blue', placedRound: 3 });
    const seen = visibleEnemies(s, d, 'blue');

    const after = resolveRound(s, d, ordersWith(s), {}).state;
    const view = viewFor(after, d, 'blue');
    expect(view.side).toBe('blue');
    expect(view.round).toBe(5);
    expect(view.allies.map((c) => c.side)).toEqual(['blue', 'blue', 'blue', 'blue', 'blue']);
    expect(view.enemies).toHaveLength(5);
    for (const e of view.enemies) {
      const real = after.champions.find((c) => c.id === e.id)!;
      if (seen.includes(e.id)) {
        expect(e).toMatchObject({ visible: true, position: real.position, lastSeenRound: 4 });
        expect(e.level).not.toBeNull();
      } else {
        const last = after.lastSeen.blue[e.id] ?? null;
        expect(e).toMatchObject({ visible: false, position: last?.position ?? null, level: null });
      }
    }
    const mid = view.enemies.find((e) => e.id === get(s, 'red', 'mid').id)!;
    expect(mid).toMatchObject({ visible: false, position: 'mid-t1-red', lastSeenRound: 2 });
    expect(view.wards.every((w) => w.side === 'blue')).toBe(true);
    expect(Object.keys(view.camps).every((id) => d.graph.positions[id]!.side === 'blue')).toBe(true);
  });

  test('round 1 shows the enemy jungler start camp', () => {
    const s = newGame(d, 9);
    const rj = get(s, 'red', 'jungle');
    const e = viewFor(s, d, 'blue').enemies.find((x) => x.id === rj.id)!;
    expect(e).toMatchObject({ visible: true, position: rj.position });
    const laner = viewFor(s, d, 'blue').enemies.find((x) => x.id === get(s, 'red', 'top').id)!;
    expect(laner).toMatchObject({ visible: false, position: null });
  });
});
