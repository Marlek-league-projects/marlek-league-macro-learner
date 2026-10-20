import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { defaultOrders, newGame, resolveRound } from '@lml/engine';
import type { ChampionState, ContactChoices, GameState, Order, Orders } from '@lml/engine/contracts';

const d = loadGameData();
const get = (s: GameState, side: string, role: string): ChampionState =>
  s.champions.find((c) => c.side === side && c.role === role)!;

function setup(round: number, place: Array<[string, string, string]>): GameState {
  const s = newGame(d, 7);
  s.round = round;
  for (const [side, role, pos] of place) {
    const c = get(s, side, role);
    c.position = pos;
    c.previous = pos;
  }
  return s;
}
const ordersWith = (s: GameState, over: Order[] = []): Orders => {
  const f = (side: 'blue' | 'red'): Order[] =>
    defaultOrders(s, d, side).map((o) => over.find((x) => x.champion === o.champion) ?? o);
  return { blue: f('blue'), red: f('red') };
};

describe('resolveRound', () => {
  function scuttleScenario(): { s: GameState; o: Orders } {
    const s = setup(7, [
      ['blue', 'jungle', 'raptors-blue'],
      ['red', 'mid', 'mid-t1-red'],
      ['red', 'jungle', 'raptors-red'],
    ]);
    const o = ordersWith(s, [
      { kind: 'move', champion: get(s, 'blue', 'jungle').id, to: 'scuttle-bot' },
      { kind: 'move', champion: get(s, 'red', 'mid').id, to: 'scuttle-bot' },
      { kind: 'move', champion: get(s, 'red', 'jungle').id, to: 'scuttle-bot' },
    ]);
    return { s, o };
  }

  test('scuttle 1v2: outnumbered blue flees by default', () => {
    const { s, o } = scuttleScenario();
    const bj = get(s, 'blue', 'jungle').id;
    const { state, events } = resolveRound(s, d, o, {});
    expect(events).toContainEqual({ type: 'fled', champion: bj, to: 'raptors-blue' });
    expect(state.champions.find((c) => c.id === bj)!.position).toBe('raptors-blue');
    expect(state.champions.find((c) => c.id === bj)!.status).toBe('alive');
    expect(events.some((e) => e.type === 'fight')).toBe(false);
  });

  test('scuttle 1v2: blue choosing fight loses and dies, red takes the scuttle', () => {
    const { s, o } = scuttleScenario();
    const bj = get(s, 'blue', 'jungle').id;
    const choices: ContactChoices = { 'scuttle-bot': { blue: 'fight' } };
    const { state, events } = resolveRound(s, d, o, choices);
    const fight = events.find((e) => e.type === 'fight');
    expect(fight).toMatchObject({ type: 'fight', position: 'scuttle-bot', winner: 'red' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'death', champion: bj }));
    expect(state.champions.find((c) => c.id === bj)!.status).not.toBe('alive');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'objectiveTaken', objective: 'scuttle', side: 'red', position: 'scuttle-bot' }),
    );
    expect(state.objectivesTaken.red.scuttle).toBe(1);
  });

  test('is deterministic and does not mutate its input', () => {
    const { s, o } = scuttleScenario();
    const choices: ContactChoices = { 'scuttle-bot': { blue: 'fight' } };
    const before = structuredClone(s);
    const a = resolveRound(s, d, o, choices);
    const b = resolveRound(s, d, o, choices);
    expect(a).toEqual(b);
    expect(s).toEqual(before);
  });

  test('throws once the game is over', () => {
    const s = newGame(d, 1);
    s.over = true;
    expect(() => resolveRound(s, d, ordersWith(s), {})).toThrow(/over/);
  });

  test('a full game of default orders ends after round 37 with a winner', () => {
    let s = newGame(d, 42);
    for (let i = 0; i < 37; i++) {
      const o: Orders = { blue: defaultOrders(s, d, 'blue'), red: defaultOrders(s, d, 'red') };
      s = resolveRound(s, d, o, {}).state;
    }
    expect(s.over).toBe(true);
    expect(s.round).toBe(38);
    expect(s.winner).not.toBeNull();
  });

  test('fleeing back onto a tile now held by an enemy starts no second contact', () => {
    const s = setup(10, [
      ['blue', 'top', 'top-t1-blue'],
      ['red', 'top', 'top-lane'],
      ['red', 'support', 'top-t1-red'],
      ['red', 'jungle', 'bluebuff-blue'],
    ]);
    const bt = get(s, 'blue', 'top').id;
    const rj = get(s, 'red', 'jungle').id;
    const o = ordersWith(s, [
      { kind: 'move', champion: bt, to: 'top-lane' },
      { kind: 'move', champion: get(s, 'red', 'support').id, to: 'top-lane' },
      { kind: 'move', champion: rj, to: 'top-t1-blue' },
    ]);
    const { state, events } = resolveRound(s, d, o, {});
    expect(events.filter((e) => e.type === 'fled')).toEqual([{ type: 'fled', champion: bt, to: 'top-t1-blue' }]);
    expect(events.filter((e) => e.type === 'fight')).toHaveLength(0);
    const btAfter = state.champions.find((c) => c.id === bt)!;
    const rjAfter = state.champions.find((c) => c.id === rj)!;
    expect([btAfter.position, btAfter.status]).toEqual(['top-t1-blue', 'alive']);
    expect([rjAfter.position, rjAfter.status]).toEqual(['top-t1-blue', 'alive']);
  });

  test('a recall not caught in a fight completes; the champion spawns next round', () => {
    const s = newGame(d, 3);
    const bm = get(s, 'blue', 'mid');
    bm.gold = 500;
    const o = ordersWith(s, [{ kind: 'recall', champion: bm.id }]);
    const r1 = resolveRound(s, d, o, {});
    expect(r1.events).toContainEqual({ type: 'recall', champion: bm.id, itemsBought: 500 });
    expect(r1.state.champions.find((c) => c.id === bm.id)!.status).toBe('respawning');
    const o2: Orders = { blue: defaultOrders(r1.state, d, 'blue'), red: defaultOrders(r1.state, d, 'red') };
    const spawn = o2.blue.find((x) => x.champion === bm.id)!;
    expect(spawn.kind).toBe('spawn');
    const r2 = resolveRound(r1.state, d, o2, {});
    const after = r2.state.champions.find((c) => c.id === bm.id)!;
    expect(after.status).toBe('alive');
    expect(after.position).toBe((spawn as { to: string }).to);
  });

  test('a champion killed in round N can spawn in round respawnRound', () => {
    const { s, o } = scuttleScenario();
    const bj = get(s, 'blue', 'jungle').id;
    const r1 = resolveRound(s, d, o, { 'scuttle-bot': { blue: 'fight' } });
    const dead = r1.state.champions.find((c) => c.id === bj)!;
    expect(dead.respawnRound).toBe(r1.state.round);
    expect(dead.status).toBe('respawning');
    expect(defaultOrders(r1.state, d, 'blue').find((x) => x.champion === bj)!.kind).toBe('spawn');
  });
});
