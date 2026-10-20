import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { defaultOrders, newGame, resolveFight, resolveRound, roundWindow } from '@lml/engine';
import type { Choice, ChampionState, ContactChoices, GameState, Order, Orders } from '@lml/engine/contracts';

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

  test('a tied fight sends both sides back, kills nobody and cancels a recall', () => {
    const s = setup(7, [
      ['blue', 'jungle', 'raptors-blue'],
      ['red', 'jungle', 'scuttle-bot'],
    ]);
    const bj = get(s, 'blue', 'jungle');
    const rj = get(s, 'red', 'jungle');
    const stage = roundWindow(d.rules, 7).stage;
    const { scores } = resolveFight(s, d, 'scuttle-bot', [bj.id], [rj.id], stage);
    const weaker = scores.blue < scores.red ? bj : rj;
    weaker.bonusLead += (Math.abs(scores.blue - scores.red) * 1000) / d.rules.fight.lead;
    expect(resolveFight(s, d, 'scuttle-bot', [bj.id], [rj.id], stage).winner).toBeNull();

    const o = ordersWith(s, [
      { kind: 'move', champion: bj.id, to: 'scuttle-bot' },
      { kind: 'recall', champion: rj.id },
    ]);
    const { state, events } = resolveRound(s, d, o, {});
    expect(events.find((e) => e.type === 'fight')).toMatchObject({ position: 'scuttle-bot', winner: null });
    expect(events.some((e) => e.type === 'death' || e.type === 'recall')).toBe(false);
    const after = (id: string): ChampionState => state.champions.find((c) => c.id === id)!;
    expect([after(bj.id).position, after(bj.id).status]).toEqual(['raptors-blue', 'alive']);
    expect([after(rj.id).position, after(rj.id).status]).toEqual(['scuttle-bot', 'alive']);
  });

  test('a Herald carrier who recalls keeps the Herald and can launch it after respawning', () => {
    const s = setup(26, [['blue', 'top', 'top-t1-blue']]);
    const bt = get(s, 'blue', 'top');
    bt.hasHerald = true;
    const r1 = resolveRound(s, d, ordersWith(s, [{ kind: 'recall', champion: bt.id }]), {});
    const after1 = r1.state.champions.find((c) => c.id === bt.id)!;
    expect(after1.status).toBe('respawning');
    expect(after1.hasHerald).toBe(true);
    const r2 = resolveRound(r1.state, d, ordersWith(r1.state, [{ kind: 'spawn', champion: bt.id, to: 'top-t1-blue' }]), {});
    expect(r2.state.champions.find((c) => c.id === bt.id)!.hasHerald).toBe(true);
    const s3 = r2.state;
    const c3 = s3.champions.find((c) => c.id === bt.id)!;
    c3.position = c3.previous = 'top-lane';
    const r3 = resolveRound(s3, d, ordersWith(s3, [{ kind: 'move', champion: bt.id, to: 'top-t1-red', launchHerald: true }]), {});
    expect(r3.events).toContainEqual({ type: 'heraldLaunched', tower: 'top-t1-red', side: 'red' });
    expect(r3.state.champions.find((c) => c.id === bt.id)!.hasHerald).toBe(false);
  });

  test('a ganked laner who did not move flees one tower back; the tower takes push damage', () => {
    const s = setup(10, [
      ['blue', 'top', 'top-t1-blue'],
      ['red', 'top', 'top-lane'],
      ['red', 'mid', 'top-lane'],
    ]);
    s.waves.top = -1;
    const bt = get(s, 'blue', 'top').id;
    const o = ordersWith(s, [
      { kind: 'move', champion: get(s, 'red', 'top').id, to: 'top-t1-blue' },
      { kind: 'move', champion: get(s, 'red', 'mid').id, to: 'top-t1-blue' },
    ]);
    const { state, events } = resolveRound(s, d, o, {});
    expect(events).toContainEqual({ type: 'fled', champion: bt, to: 'top-t2-blue' });
    const after = state.champions.find((c) => c.id === bt)!;
    expect([after.position, after.status]).toEqual(['top-t2-blue', 'alive']);
    expect(state.towers['top-t1-blue']).toBe(d.rules.towers.hp - d.rules.towers.pushDamage[1]!);
  });

  test('fleeing in place off a T3 goes to base; off a non-lane tile to the neighbour closest to base', () => {
    const s = setup(10, [
      ['blue', 'top', 'top-t3-blue'],
      ['red', 'top', 'top-t2-blue'],
      ['red', 'mid', 'top-t2-blue'],
      ['blue', 'jungle', 'raptors-blue'],
      ['red', 'jungle', 'scuttle-bot'],
      ['red', 'support', 'scuttle-bot'],
    ]);
    const o = ordersWith(s, [
      { kind: 'move', champion: get(s, 'red', 'top').id, to: 'top-t3-blue' },
      { kind: 'move', champion: get(s, 'red', 'mid').id, to: 'top-t3-blue' },
      { kind: 'move', champion: get(s, 'red', 'jungle').id, to: 'raptors-blue' },
      { kind: 'move', champion: get(s, 'red', 'support').id, to: 'raptors-blue' },
    ]);
    const { state } = resolveRound(s, d, o, {});
    expect(get(state, 'blue', 'top').position).toBe('base-blue');
    // raptors-blue neighbours: mid-t1-blue (3 from base), redbuff-blue, scuttle-bot, ...; mid-t1-blue is closest.
    expect(get(state, 'blue', 'jungle').position).toBe('mid-t1-blue');
  });

  test('a spawning champion who flees retreats one tower back', () => {
    const s = setup(10, [
      ['red', 'top', 'top-lane'],
      ['red', 'mid', 'top-lane'],
    ]);
    const bt = get(s, 'blue', 'top');
    bt.status = 'respawning';
    bt.respawnRound = 10;
    const o = ordersWith(s, [
      { kind: 'spawn', champion: bt.id, to: 'top-t1-blue' },
      { kind: 'move', champion: get(s, 'red', 'top').id, to: 'top-t1-blue' },
      { kind: 'move', champion: get(s, 'red', 'mid').id, to: 'top-t1-blue' },
    ]);
    const { state } = resolveRound(s, d, o, { 'top-t1-blue': { blue: 'flee' } });
    const after = state.champions.find((c) => c.id === bt.id)!;
    expect([after.position, after.status]).toEqual(['top-t2-blue', 'alive']);
  });

  test('a lane contact where one side flees is won by the side that stayed: wave and trade lead', () => {
    const s = setup(10, [
      ['blue', 'top', 'top-t1-blue'],
      ['red', 'top', 'top-t1-red'],
    ]);
    const bt = get(s, 'blue', 'top');
    const rt = get(s, 'red', 'top');
    const lead0 = rt.bonusLead;
    const o = ordersWith(s, [
      { kind: 'move', champion: bt.id, to: 'top-lane' },
      { kind: 'move', champion: rt.id, to: 'top-lane' },
    ]);
    const { state, events } = resolveRound(s, d, o, { 'top-lane': { blue: 'flee' } });
    expect(events).toContainEqual({ type: 'fled', champion: bt.id, to: 'top-t1-blue' });
    expect(events).toContainEqual({ type: 'trade', position: 'top-lane', lane: 'top', winner: 'red' });
    expect(state.waves.top).toBe(-1);
    expect(state.champions.find((c) => c.id === rt.id)!.bonusLead).toBe(lead0 + d.rules.economy.tradeLead);
  });

  describe('even lane contact choices', () => {
    function laneRound(choices: { blue: Choice; red: Choice }) {
      const s = setup(10, [
        ['blue', 'top', 'top-t1-blue'],
        ['red', 'top', 'top-t1-red'],
      ]);
      const bt = get(s, 'blue', 'top');
      const rt = get(s, 'red', 'top');
      bt.bonusLead += 100_000;
      const o = ordersWith(s, [
        { kind: 'move', champion: bt.id, to: 'top-lane' },
        { kind: 'move', champion: rt.id, to: 'top-lane' },
      ]);
      const r = resolveRound(s, d, o, { 'top-lane': choices });
      return { ...r, bt, rt };
    }
    const alive = (st: GameState, id: string) => st.champions.find((c) => c.id === id)!.status === 'alive';

    test('farm vs farm: no fight, no trade, nobody dies, the fight-score push applies', () => {
      const { state, events, bt, rt } = laneRound({ blue: 'farm', red: 'farm' });
      expect(events.some((e) => e.type === 'fight' || e.type === 'trade')).toBe(false);
      expect(alive(state, bt.id) && alive(state, rt.id)).toBe(true);
      expect(state.waves.top).toBe(1);
    });
    test('farm vs trade: a trade won by the fight score, nobody dies', () => {
      const { state, events, bt, rt } = laneRound({ blue: 'farm', red: 'trade' });
      expect(events).toContainEqual({ type: 'trade', position: 'top-lane', lane: 'top', winner: 'blue' });
      expect(events.some((e) => e.type === 'fight')).toBe(false);
      expect(alive(state, bt.id) && alive(state, rt.id)).toBe(true);
    });
    test('trade vs trade is a trade', () => {
      const { events } = laneRound({ blue: 'trade', red: 'trade' });
      expect(events).toContainEqual({ type: 'trade', position: 'top-lane', lane: 'top', winner: 'blue' });
    });
    test.each<Choice>(['farm', 'trade'])('all-in vs %s is a fight and the loser dies', (other) => {
      const { state, events, bt, rt } = laneRound({ blue: 'fight', red: other });
      expect(events.some((e) => e.type === 'fight' && e.winner === 'blue')).toBe(true);
      expect(alive(state, bt.id)).toBe(true);
      expect(alive(state, rt.id)).toBe(false);
    });
    test('farm vs flee concedes the trade to the side that stayed', () => {
      const { events } = laneRound({ blue: 'flee', red: 'farm' });
      expect(events).toContainEqual({ type: 'trade', position: 'top-lane', lane: 'top', winner: 'red' });
    });
  });

  test("a 'to' ward is not placed when the champion fled off its destination", () => {
    const s = setup(10, [
      ['blue', 'top', 'top-t1-blue'],
      ['red', 'top', 'top-t1-red'],
      ['red', 'jungle', 'top-t1-red'],
    ]);
    const bt = get(s, 'blue', 'top').id;
    const o = ordersWith(s, [
      { kind: 'move', champion: bt, to: 'top-lane', ward: 'to' },
      { kind: 'move', champion: get(s, 'red', 'top').id, to: 'top-lane' },
      { kind: 'move', champion: get(s, 'red', 'jungle').id, to: 'top-lane' },
    ]);
    const { state, events } = resolveRound(s, d, o, {});
    expect(events).toContainEqual({ type: 'fled', champion: bt, to: 'top-t1-blue' });
    expect(state.wards.some((w) => w.side === 'blue')).toBe(false);
    expect(events.some((e) => e.type === 'wardPlaced')).toBe(false);
  });

  test('an unward removes an enemy ward before it gives vision', () => {
    const run = (unward: boolean): { state: GameState; events: ReturnType<typeof resolveRound>['events'] } => {
      const s = setup(4, [['blue', 'jungle', 'raptors-blue']]);
      s.wards.push({ side: 'red', position: 'raptors-blue', placedRound: 3 });
      const bj = get(s, 'blue', 'jungle').id;
      const o = ordersWith(s, unward ? [{ kind: 'move', champion: bj, to: 'raptors-blue', unward: 'to' }] : []);
      return resolveRound(s, d, o, {});
    };
    const bjId = (st: GameState): string => get(st, 'blue', 'jungle').id;
    const control = run(false);
    expect(control.state.lastSeen.red[bjId(control.state)]).toEqual({ position: 'raptors-blue', round: 4 });
    const cleared = run(true);
    expect(cleared.events).toContainEqual({ type: 'wardCleared', side: 'red', position: 'raptors-blue' });
    expect(cleared.state.lastSeen.red[bjId(cleared.state)]?.round ?? null).not.toBe(4);
  });
});
