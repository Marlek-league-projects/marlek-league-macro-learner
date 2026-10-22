import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { defaultOrders, eventsFor, newGame, resolveFight, resolveRound, roundWindow } from '@lml/engine';
import type { ChampionState, ContactChoices, GameEvent, GameState, Order, Orders, Stance } from '@lml/engine/contracts';

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
    const choices: ContactChoices = { 'river-bot': { blue: 'fight' } };
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
    const choices: ContactChoices = { 'river-bot': { blue: 'fight' } };
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

  test('a full game of default orders ends after round 71 with a winner', () => {
    let s = newGame(d, 42);
    for (let i = 0; i < 71; i++) {
      const o: Orders = { blue: defaultOrders(s, d, 'blue'), red: defaultOrders(s, d, 'red') };
      s = resolveRound(s, d, o, {}).state;
    }
    expect(s.over).toBe(true);
    expect(s.round).toBe(72);
    expect(s.winner).not.toBeNull();
  });

  test('fleeing back onto a tile now held by an enemy starts no second contact', () => {
    const s = setup(10, [
      ['blue', 'top', 'top-t1-blue'],
      ['red', 'top', 'top-lane'],
      ['red', 'support', 'scuttle-top'],
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
    expect(events.filter((e) => e.type === 'fled' && e.champion !== get(s, 'red', 'adc').id)).toEqual([
      { type: 'fled', champion: bt, to: 'top-t1-blue' },
    ]);
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

  test('a recall with a step can ward and unward the step position', () => {
    const s = newGame(d, 3);
    const bj = get(s, 'blue', 'jungle');
    bj.position = 'raptors-blue';
    s.wards.push({ side: 'red', position: 'mid-t1-blue', placedRound: 0 });
    const o = ordersWith(s, [{ kind: 'recall', champion: bj.id, to: 'mid-t1-blue', ward: 'to', unward: 'to' }]);
    const r = resolveRound(s, d, o, {});
    expect(r.events).toContainEqual({ type: 'wardCleared', side: 'red', position: 'mid-t1-blue' });
    expect(r.events).toContainEqual({ type: 'wardPlaced', side: 'blue', position: 'mid-t1-blue' });
    expect(r.state.wards.filter((w) => w.position === 'mid-t1-blue').map((w) => w.side)).toEqual(['blue']);
  });

  test('a champion killed in round N can spawn in round respawnRound', () => {
    const { s, o } = scuttleScenario();
    const bj = get(s, 'blue', 'jungle').id;
    const r1 = resolveRound(s, d, o, { 'river-bot': { blue: 'fight' } });
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

  test('a tied fight sends an arrival-only champion back without an action; a champion who stayed still acts', () => {
    const s = setup(7, [
      ['blue', 'jungle', 'gromp-blue'],
      ['red', 'jungle', 'raptors-red'],
    ]);
    const bj = get(s, 'blue', 'jungle');
    const rj = get(s, 'red', 'jungle');
    const stage = roundWindow(d.rules, 7).stage;
    const { scores } = resolveFight(s, d, 'raptors-red', [bj.id], [rj.id], stage);
    const weaker = scores.blue < scores.red ? bj : rj;
    weaker.bonusLead += (Math.abs(scores.blue - scores.red) * 1000) / d.rules.fight.lead;
    expect(resolveFight(s, d, 'raptors-red', [bj.id], [rj.id], stage).winner).toBeNull();

    // gromp-blue to raptors-red takes the whole budget: no step left to act on arrival.
    const o = ordersWith(s, [
      { kind: 'move', champion: bj.id, to: 'raptors-red' },
      { kind: 'move', champion: rj.id, to: 'raptors-red' },
    ]);
    const { state, events } = resolveRound(s, d, o, {});
    expect(events.find((e) => e.type === 'fight')).toMatchObject({ position: 'raptors-red', winner: null });
    expect(state.champions.find((c) => c.id === bj.id)!.position).toBe('gromp-blue');
    expect(events.some((e) => e.type === 'campCleared' && e.champion === bj.id)).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'campCleared', camp: 'raptors-red', champion: rj.id }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'moved', champion: bj.id, acted: false }));
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
      ['red', 'mid', 'scuttle-top'],
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
    // The gank ended with no kill and the wave was already at the tower: push damage plus a plate.
    expect(state.towers['top-t1-blue']).toBe(d.rules.towers.hp - d.rules.towers.pushDamage[1]! - 1);
  });

  test('fleeing in place off a T3 goes to base; off a non-lane tile to the neighbour closest to base', () => {
    const s = setup(10, [
      ['blue', 'top', 'top-t3-blue'],
      ['red', 'top', 'top-t2-blue'],
      ['red', 'jungle', 'gromp-blue'],
      ['blue', 'jungle', 'raptors-blue'],
      ['red', 'mid', 'scuttle-bot'],
      ['red', 'support', 'scuttle-bot'],
    ]);
    const o = ordersWith(s, [
      { kind: 'move', champion: get(s, 'blue', 'top').id, to: 'top-t3-blue' },
      { kind: 'move', champion: get(s, 'red', 'top').id, to: 'top-t3-blue' },
      { kind: 'move', champion: get(s, 'red', 'jungle').id, to: 'top-t3-blue' },
      { kind: 'move', champion: get(s, 'red', 'mid').id, to: 'raptors-blue' },
      { kind: 'move', champion: get(s, 'red', 'support').id, to: 'raptors-blue' },
    ]);
    const { state } = resolveRound(s, d, o, {});
    expect(get(state, 'blue', 'top').position).toBe('base-blue');
    // raptors-blue neighbours: mid-t2-blue (2 from base), mid-t1-blue, krugs-blue, scuttle-bot, ...; mid-t2-blue is closest.
    expect(get(state, 'blue', 'jungle').position).toBe('mid-t2-blue');
  });

  test('a spawning champion who flees goes back to its base, where its move started', () => {
    const s = setup(10, [
      ['red', 'top', 'top-lane'],
      ['red', 'mid', 'scuttle-top'],
    ]);
    const bt = get(s, 'blue', 'top');
    bt.status = 'respawning';
    bt.respawnRound = 10;
    const o = ordersWith(s, [
      { kind: 'spawn', champion: bt.id, to: 'top-t1-blue' },
      { kind: 'move', champion: get(s, 'red', 'top').id, to: 'top-t1-blue' },
      { kind: 'move', champion: get(s, 'red', 'mid').id, to: 'top-t1-blue' },
    ]);
    const { state } = resolveRound(s, d, o, { 'lane-top': { blue: 'flee' } });
    const after = state.champions.find((c) => c.id === bt.id)!;
    expect([after.position, after.status]).toEqual(['base-blue', 'alive']);
  });

  test('a spawn on the T1 arrives without acting: 2 steps plus the base bonus do not leave one to act', () => {
    const s = setup(10, []);
    const bt = get(s, 'blue', 'top');
    bt.status = 'respawning';
    bt.respawnRound = s.round;
    const { events } = resolveRound(s, d, ordersWith(s, [{ kind: 'spawn', champion: bt.id, to: 'top-t1-blue' }]), {});
    expect(events).toContainEqual({ type: 'moved', champion: bt.id, from: 'base-blue', to: 'top-t1-blue', acted: false });
  });

  test('a gank in lane where one side flees is won by the side that stayed: wave and trade lead', () => {
    const s = setup(10, [
      ['blue', 'top', 'top-t1-blue'],
      ['red', 'top', 'top-t1-red'],
      ['red', 'jungle', 'scuttle-top'],
    ]);
    const bt = get(s, 'blue', 'top');
    const rt = get(s, 'red', 'top');
    const lead0 = rt.bonusLead;
    const o = ordersWith(s, [
      { kind: 'move', champion: bt.id, to: 'top-lane' },
      { kind: 'move', champion: rt.id, to: 'top-lane' },
      { kind: 'move', champion: get(s, 'red', 'jungle').id, to: 'top-lane' },
    ]);
    const { state, events } = resolveRound(s, d, o, { 'lane-top': { blue: 'flee' } });
    expect(events).toContainEqual({ type: 'fled', champion: bt.id, to: 'top-t1-blue' });
    expect(events).toContainEqual({ type: 'trade', position: 'top-lane', lane: 'top', winner: 'red' });
    expect(state.waves.top).toBe(-1);
    expect(state.champions.find((c) => c.id === rt.id)!.bonusLead).toBe(lead0 + d.rules.economy.tradeLead);
  });

  describe('even lane contacts resolve from the stances', () => {
    function laneRound(stances: { blue: Stance; red: Stance }) {
      const s = setup(10, [
        ['blue', 'top', 'top-t1-blue'],
        ['red', 'top', 'top-t1-red'],
      ]);
      const bt = get(s, 'blue', 'top');
      const rt = get(s, 'red', 'top');
      bt.bonusLead += 100_000;
      const o = ordersWith(s, [
        { kind: 'move', champion: bt.id, to: 'top-lane', stance: stances.blue },
        { kind: 'move', champion: rt.id, to: 'top-lane', stance: stances.red },
      ]);
      const r = resolveRound(s, d, o, {});
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
    test('all-in vs trade is a fight and the loser dies', () => {
      const { state, events, bt, rt } = laneRound({ blue: 'allin', red: 'trade' });
      expect(events.some((e) => e.type === 'fight' && e.winner === 'blue')).toBe(true);
      expect(alive(state, bt.id)).toBe(true);
      expect(alive(state, rt.id)).toBe(false);
    });
    test('all-in vs farm: Farm plays safe, the all-in side only wins the trade', () => {
      const { state, events, bt, rt } = laneRound({ blue: 'allin', red: 'farm' });
      expect(events).toContainEqual({ type: 'trade', position: 'top-lane', lane: 'top', winner: 'blue' });
      expect(events.some((e) => e.type === 'fight' || e.type === 'death')).toBe(false);
      expect(alive(state, bt.id) && alive(state, rt.id)).toBe(true);
    });
  });

  test("a 'to' ward is not placed when the champion fled off its destination", () => {
    const s = setup(10, [
      ['blue', 'top', 'top-t1-blue'],
      ['red', 'top', 'top-t1-red'],
      ['red', 'jungle', 'scuttle-top'],
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

describe('an action needs a step left on arrival', () => {
  test('a jungler arriving on a camp 2 steps away (budget 2) does not clear it, and clears it next round by staying', () => {
    const s = setup(2, [['blue', 'jungle', 'wolves-blue']]);
    const bj = get(s, 'blue', 'jungle').id;
    const first = resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: bj, to: 'krugs-blue' }]), {});
    expect(first.events).toContainEqual({ type: 'moved', champion: bj, from: 'wolves-blue', to: 'krugs-blue', acted: false });
    expect(get(first.state, 'blue', 'jungle').position).toBe('krugs-blue');
    expect(first.events.some((e) => e.type === 'campCleared' && e.camp === 'krugs-blue')).toBe(false);
    expect(first.state.camps['krugs-blue']).toBe(d.rules.camps.firstSpawn);

    const second = resolveRound(first.state, d, ordersWith(first.state), {});
    expect(second.events).toContainEqual({ type: 'campCleared', camp: 'krugs-blue', champion: bj });
  });

  test('a laner arriving in its lane on its last step gets no farm; one step less farms', () => {
    const farmOf = (from: string): number => {
      const s = setup(4, [
        ['blue', 'top', from],
        ['red', 'top', 'top-t2-red'],
      ]);
      s.waves.top = -1;
      const bt = get(s, 'blue', 'top');
      const before = bt.gold;
      const { state, events } = resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: bt.id, to: 'top-lane' }]), {});
      expect(events.some((e) => e.type === 'fight' || e.type === 'trade')).toBe(false);
      const passive = (d.rules.economy.passiveGoldPerMin * roundWindow(d.rules, 4).seconds) / 60;
      return get(state, 'blue', 'top').gold - before - passive;
    };
    expect(farmOf('top-t2-blue')).toBe(0);
    expect(farmOf('top-t1-blue')).toBeGreaterThan(0);
  });
});

describe('fleeing, retreating or an interrupted recall forfeits the action', () => {
  test('a jungler fleeing back to its camp does not clear it, and its move did not act', () => {
    const s = setup(7, [
      ['blue', 'jungle', 'raptors-blue'],
      ['red', 'mid', 'mid-t1-red'],
      ['red', 'jungle', 'raptors-red'],
    ]);
    const bj = get(s, 'blue', 'jungle').id;
    const o = ordersWith(s, [
      { kind: 'move', champion: bj, to: 'scuttle-bot' },
      { kind: 'move', champion: get(s, 'red', 'mid').id, to: 'scuttle-bot' },
      { kind: 'move', champion: get(s, 'red', 'jungle').id, to: 'scuttle-bot' },
    ]);
    const { state, events } = resolveRound(s, d, o, {});
    expect(get(state, 'blue', 'jungle').position).toBe('raptors-blue');
    expect(events.some((e) => e.type === 'campCleared' && e.champion === bj)).toBe(false);
    expect(events).toContainEqual({ type: 'moved', champion: bj, from: 'raptors-blue', to: 'scuttle-bot', acted: false });
  });

  test('a recall interrupted by a fight forfeits the action at the step position (no farm)', () => {
    const s = setup(10, [
      ['blue', 'top', 'top-lane'],
      ['red', 'top', 'top-t1-blue'],
    ]);
    s.waves.top = -1;
    get(s, 'blue', 'top').bonusLead += 100_000;
    get(s, 'red', 'top').stance = 'allin';
    get(s, 'blue', 'top').stance = 'trade';
    const bt = get(s, 'blue', 'top');
    const before = bt.gold;
    const { state, events } = resolveRound(s, d, ordersWith(s, [{ kind: 'recall', champion: bt.id, to: 'top-t1-blue' }]), {});
    expect(events.some((e) => e.type === 'fight' && e.winner === 'blue')).toBe(true);
    expect(events).toContainEqual({ type: 'moved', champion: bt.id, from: 'top-lane', to: 'top-t1-blue', acted: false });
    const kills = events.filter((e) => e.type === 'death').length;
    const passive = (d.rules.economy.passiveGoldPerMin * roundWindow(d.rules, 10).seconds) / 60;
    expect(get(state, 'blue', 'top').gold - before).toBeCloseTo(passive + kills * d.rules.economy.killGold, 6);
  });
});

describe('a contested river', () => {
  /** Round 11, Dragon up and held by the blue jungler since round 10; the red jungler arrives on the Scuttle. */
  function river(): { s: GameState; o: Orders; bj: string; rj: string } {
    const s = setup(11, [
      ['blue', 'jungle', 'dragon-pit'],
      ['red', 'jungle', 'bluebuff-red'],
    ]);
    s.pits['dragon-pit'] = { objective: 'dragon', nextSpawn: null, capture: { side: 'blue', startedRound: 10 } };
    const bj = get(s, 'blue', 'jungle').id;
    const rj = get(s, 'red', 'jungle').id;
    const o = ordersWith(s, [
      { kind: 'move', champion: bj, to: 'dragon-pit' },
      { kind: 'move', champion: rj, to: 'scuttle-bot' },
    ]);
    return { s, o, bj, rj };
  }
  const taken = (events: GameEvent[], objective: string): GameEvent | undefined =>
    events.find((e) => e.type === 'objectiveTaken' && e.objective === objective);

  test('objective against flee: the Dragon (when due) and the Scuttle are taken', () => {
    const { s, o, bj, rj } = river();
    const { events } = resolveRound(s, d, o, { 'river-bot': { blue: 'objective', red: 'flee' } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'fled', champion: rj }));
    expect(taken(events, 'dragon')).toMatchObject({ side: 'blue', champions: [bj] });
    expect(taken(events, 'scuttle')).toMatchObject({ side: 'blue', position: 'scuttle-bot', champions: [bj] });
  });

  test('objective against fight: the objective side scores objectiveFocus of its strength', () => {
    const { s, o, bj, rj } = river();
    const { events } = resolveRound(s, d, o, { 'river-bot': { blue: 'objective', red: 'fight' } });
    const fight = events.find((e) => e.type === 'fight');
    const stage = roundWindow(d.rules, 11).stage;
    const plain = resolveFight(s, d, 'dragon-pit', [bj], [rj], stage).scores;
    expect(fight?.type === 'fight' && fight.scores.blue).toBeCloseTo(plain.blue * d.rules.fight.objectiveFocus, 9);
    expect(fight?.type === 'fight' && fight.scores.red).toBeCloseTo(plain.red, 9);
  });

  test('objective against fight: if the objective side still wins it takes the objective and the kill', () => {
    const { s, o, bj, rj } = river();
    get(s, 'blue', 'jungle').bonusLead += 100_000;
    const { state, events } = resolveRound(s, d, o, { 'river-bot': { blue: 'objective', red: 'fight' } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'death', champion: rj }));
    expect(taken(events, 'dragon')).toMatchObject({ side: 'blue', champions: [bj] });
    expect(state.objectivesTaken.blue.dragon).toBe(1);
  });

  test('objective against objective: a race won by the higher score, nobody dies or loses HP', () => {
    const { s, o, bj, rj } = river();
    get(s, 'blue', 'jungle').bonusLead += 100_000;
    const { state, events } = resolveRound(s, d, o, { 'river-bot': { blue: 'objective', red: 'objective' } });
    expect(events.some((e) => e.type === 'fight' || e.type === 'death' || e.type === 'hpLost')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'fled', champion: rj }));
    expect(taken(events, 'dragon')).toMatchObject({ side: 'blue', champions: [bj] });
    expect(get(state, 'red', 'jungle').status).toBe('alive');
  });

  test('objective against objective on an exact tie: nobody takes anything', () => {
    const { s, o, bj, rj } = river();
    // Even the scores out through the red jungler's lead (full HP: one lead point is `fight.lead / 1000` score).
    const stage = roundWindow(d.rules, 11).stage;
    const gap = (): number => {
      const { scores } = resolveFight(s, d, 'dragon-pit', [bj], [rj], stage);
      return scores.blue - scores.red;
    };
    get(s, 'red', 'jungle').bonusLead += (gap() * 1000) / d.rules.fight.lead;
    expect(Math.abs(gap())).toBeLessThan(1e-9);
    const { state, events } = resolveRound(s, d, o, { 'river-bot': { blue: 'objective', red: 'objective' } });
    expect(events.some((e) => e.type === 'objectiveTaken' || e.type === 'fled' || e.type === 'death')).toBe(false);
    expect(state.pits['dragon-pit'].objective).toBe('dragon');
  });
});

describe('HP losses are visible', () => {
  test('a trade loser at 100 ends the round at 80, with no regen, and an hpLost event', () => {
    const s = setup(10, [['blue', 'top', 'top-lane'], ['red', 'top', 'top-lane']]);
    s.waves.top = 0;
    get(s, 'blue', 'top').bonusLead += 100_000;
    const rt = get(s, 'red', 'top').id;
    const { state, events } = resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: rt, to: 'top-lane', stance: 'trade' }]), {});
    expect(get(state, 'red', 'top').hp).toBe(80);
    expect(events).toContainEqual({ type: 'hpLost', champion: rt, amount: d.rules.health.tradeLoss });
  });

  test('eventsFor shows hpLost for own champions and for enemies visible after the round only', () => {
    const s = setup(10, [['blue', 'top', 'top-lane'], ['red', 'top', 'top-lane']]);
    get(s, 'blue', 'top').bonusLead += 100_000;
    const bt = get(s, 'blue', 'top').id;
    const rt = get(s, 'red', 'top').id;
    const { state, events } = resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: rt, to: 'top-lane', stance: 'trade' }]), {});
    const hidden: GameEvent[] = [...events, { type: 'hpLost', champion: get(s, 'red', 'jungle').id, amount: 15 }];
    const forBlue = eventsFor(hidden, state, d, 'blue').filter((e) => e.type === 'hpLost');
    expect(forBlue).toEqual([
      { type: 'hpLost', champion: bt, amount: d.rules.health.tradeWinnerLoss },
      { type: 'hpLost', champion: rt, amount: d.rules.health.tradeLoss },
    ]);
  });
});

describe('acting after a lane pull-in', () => {
  /** Round 1 (budget 2): a top skirmish at top-lane, blue winning; the blue jungler goes `from` → `to`, pulled to top-lane. */
  function pulled(from: string, to: string): { r: ReturnType<typeof resolveRound>; bj: string; xpBefore: number } {
    const s = setup(1, [
      ['blue', 'top', 'top-lane'],
      ['blue', 'jungle', from],
      ['red', 'top', 'top-lane'],
      ['red', 'jungle', 'top-lane'],
    ]);
    for (const role of ['top', 'jungle']) get(s, 'blue', role).bonusLead += 100_000;
    const bj = get(s, 'blue', 'jungle').id;
    const stay = (side: string, role: string): Order => ({ kind: 'move', champion: get(s, side, role).id, to: get(s, side, role).position });
    const o = ordersWith(s, [stay('blue', 'top'), stay('red', 'top'), stay('red', 'jungle'), { kind: 'move', champion: bj, to }]);
    const xpBefore = get(s, 'blue', 'jungle').xp;
    return { r: resolveRound(s, d, o, { 'lane-top': { blue: 'fight', red: 'fight' } }), bj, xpBefore };
  }
  const killXpShare = (events: GameEvent[]): number =>
    (events.filter((e) => e.type === 'death').length * d.rules.economy.killXp) / 2;

  test('an arrival-only champion pulled back to the fight gains no action and does not farm', () => {
    const { r, bj, xpBefore } = pulled('top-t1-blue', 'top-t1-red');
    expect(r.events.some((e) => e.type === 'fight' && e.winner === 'blue')).toBe(true);
    expect(get(r.state, 'blue', 'jungle').position).toBe('top-lane');
    expect(r.events.filter((e) => e.type === 'moved' && e.champion === bj).every((e) => e.type === 'moved' && !e.acted)).toBe(true);
    expect(get(r.state, 'blue', 'jungle').xp - xpBefore).toBeCloseTo(killXpShare(r.events), 9);
  });

  test('an acting champion pulled away keeps its action and farms', () => {
    const { r, bj, xpBefore } = pulled('krugs-red', 'top-t1-red');
    expect(get(r.state, 'blue', 'jungle').position).toBe('top-lane');
    expect(r.events.filter((e) => e.type === 'moved' && e.champion === bj).every((e) => e.type === 'moved' && e.acted)).toBe(true);
    expect(get(r.state, 'blue', 'jungle').xp - xpBefore).toBeGreaterThan(killXpShare(r.events) + 1e-9);
  });
});

describe('a plain fight on a pit', () => {
  function river(): { s: GameState; o: Orders } {
    const s = setup(11, [
      ['blue', 'jungle', 'dragon-pit'],
      ['red', 'jungle', 'bluebuff-red'],
    ]);
    s.pits['dragon-pit'] = { objective: 'dragon', nextSpawn: null, capture: { side: 'blue', startedRound: 10 } };
    get(s, 'blue', 'jungle').bonusLead += 100_000;
    const o = ordersWith(s, [
      { kind: 'move', champion: get(s, 'blue', 'jungle').id, to: 'dragon-pit' },
      { kind: 'move', champion: get(s, 'red', 'jungle').id, to: 'scuttle-bot' },
    ]);
    return { s, o };
  }
  const noDragon = (r: ReturnType<typeof resolveRound>): void => {
    expect(r.events.some((e) => (e.type === 'objectiveTaken' || e.type === 'objectiveStarted') && e.objective === 'dragon')).toBe(false);
    expect(r.state.pits['dragon-pit']).toMatchObject({ objective: 'dragon', capture: null });
  };

  test('a fight winner does not continue or take the pit objective', () => {
    const { s, o } = river();
    const r = resolveRound(s, d, o, { 'river-bot': { blue: 'fight', red: 'fight' } });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'death', champion: get(s, 'red', 'jungle').id }));
    noDragon(r);
  });

  test('fight against flee: the fighting side does not take the pit objective', () => {
    const { s, o } = river();
    noDragon(resolveRound(s, d, o, { 'river-bot': { blue: 'fight', red: 'flee' } }));
  });
});
