import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { defaultOrders, newGame, resolveFight, resolveRound, roundWindow } from '@lml/engine';
import type { ChampionState, ContactChoices, GameEvent, GameState, Order, Orders } from '@lml/engine/contracts';

const d = loadGameData();
const W = d.rules.fight;
const H = d.rules.health;
const get = (s: GameState, side: string, role: string): ChampionState =>
  s.champions.find((c) => c.side === side && c.role === role)!;
const byId = (s: GameState, id: string): ChampionState => s.champions.find((c) => c.id === id)!;
const ordersWith = (s: GameState, over: Order[] = []): Orders => {
  const f = (side: 'blue' | 'red'): Order[] =>
    defaultOrders(s, d, side).map((o) => over.find((x) => x.champion === o.champion) ?? o);
  return { blue: f('blue'), red: f('red') };
};

function setup(place: Array<[string, string, string]>): GameState {
  const s = newGame(d, 7);
  s.round = 10;
  for (const c of s.champions) {
    c.xp = 0; c.items = 0; c.bonusLead = 0;
  }
  for (const [side, role, pos] of place) {
    const c = get(s, side, role);
    c.position = pos;
    c.previous = pos;
  }
  return s;
}
const stageOf = (s: GameState) => roundWindow(d.rules, s.round).stage;

/** Shifts `c`'s lead (at full health) so that blue's score minus red's equals `gap` at `position`. */
function setGap(
  s: GameState, c: ChampionState, position: string, blue: string[], red: string[], gap: number, ganked: 'blue' | 'red' | null = null,
): void {
  const { scores } = resolveFight(s, d, position, blue, red, stageOf(s), ganked);
  const now = scores.blue - scores.red;
  const sign = c.side === 'blue' ? 1 : -1;
  c.bonusLead += (sign * (gap - now) * 1000) / W.lead / (1 - H.fightWeight * (1 - c.hp / H.max));
}

describe('graded deaths in a 2v2 All-in', () => {
  function duo(): { s: GameState; blue: string[]; red: string[] } {
    const s = setup([
      ['blue', 'adc', 'bot-lane'],
      ['blue', 'support', 'bot-lane'],
      ['red', 'adc', 'bot-lane'],
      ['red', 'support', 'bot-lane'],
    ]);
    s.waves.bot = 0;
    for (const c of s.champions) if (c.role === 'adc' || c.role === 'support') c.stance = 'allin';
    const ids = (side: string) => ['adc', 'support'].map((r) => get(s, side, r).id).sort();
    return { s, blue: ids('blue'), red: ids('red') };
  }
  const deaths = (events: GameEvent[]) => events.filter((e) => e.type === 'death');

  test('a small gap kills nobody; every losing survivor loses survivorLoss HP', () => {
    const { s, blue, red } = duo();
    setGap(s, get(s, 'blue', 'adc'), 'bot-lane', blue, red, W.deathGap * 0.5);
    const { state, events } = resolveRound(s, d, ordersWith(s), {});
    expect(events.some((e) => e.type === 'fight' && e.winner === 'blue')).toBe(true);
    expect(deaths(events)).toHaveLength(0);
    for (const id of red) {
      expect(byId(state, id).status).toBe('alive');
      expect(byId(state, id).hp).toBe(H.max - W.survivorLoss);
    }
  });

  test('a medium gap kills one of two, the survivor loses HP; kill rewards per victim', () => {
    const { s, blue, red } = duo();
    setGap(s, get(s, 'blue', 'adc'), 'bot-lane', blue, red, W.deathGap * 1.5);
    const { state, events } = resolveRound(s, d, ordersWith(s), {});
    expect(deaths(events)).toHaveLength(1);
    expect(state.kills.blue - s.kills.blue).toBe(1);
    const survivor = red.find((id) => byId(state, id).status === 'alive')!;
    expect(byId(state, survivor).hp).toBe(H.max - W.survivorLoss);
  });

  test('a large gap kills every loser', () => {
    const { s, blue, red } = duo();
    setGap(s, get(s, 'blue', 'adc'), 'bot-lane', blue, red, W.deathGap * 2.5);
    const { state, events } = resolveRound(s, d, ordersWith(s), {});
    expect(deaths(events).map((e) => e.champion).sort()).toEqual(red);
    expect(state.kills.blue - s.kills.blue).toBe(2);
  });

  test('the most wounded die first, ties broken by id', () => {
    for (const wounded of ['adc', 'support']) {
      const { s, blue, red } = duo();
      get(s, 'red', wounded).hp = 40;
      setGap(s, get(s, 'blue', 'adc'), 'bot-lane', blue, red, W.deathGap * 1.5);
      const { events } = resolveRound(s, d, ordersWith(s), {});
      expect(deaths(events).map((e) => e.champion)).toEqual([get(s, 'red', wounded).id]);
    }
    const { s, blue, red } = duo();
    setGap(s, get(s, 'blue', 'adc'), 'bot-lane', blue, red, W.deathGap * 1.5);
    const { events } = resolveRound(s, d, ordersWith(s), {});
    expect(deaths(events).map((e) => e.champion)).toEqual([red[0]!]);
  });

  test('Farm stays safe: a Farm loser is never a victim even with a large gap', () => {
    const { s, blue, red } = duo();
    const ra = get(s, 'red', 'adc');
    ra.stance = 'farm';
    ra.hp = 10;
    setGap(s, get(s, 'blue', 'adc'), 'bot-lane', blue, red, W.deathGap * 5);
    const { state, events } = resolveRound(s, d, ordersWith(s), {});
    expect(deaths(events).map((e) => e.champion)).toEqual([get(s, 'red', 'support').id]);
    expect(byId(state, ra.id).status).toBe('alive');
  });
});

describe('ganks and lane position', () => {
  /** Red jungle ganks blue top on top-lane, where both tops walk to (explicit orders, so they don't follow the wave). */
  function gank(wave: -1 | 0 | 1): { s: GameState; o: Orders; blue: string[]; red: string[] } {
    const s = setup([
      ['blue', 'top', 'top-t1-blue'],
      ['red', 'top', 'top-t1-red'],
      ['red', 'jungle', 'scuttle-top'],
    ]);
    s.waves.top = wave;
    const o = ordersWith(s, [
      { kind: 'move', champion: get(s, 'blue', 'top').id, to: 'top-lane' },
      { kind: 'move', champion: get(s, 'red', 'top').id, to: 'top-lane' },
      { kind: 'move', champion: get(s, 'red', 'jungle').id, to: 'top-lane' },
    ]);
    const blue = [get(s, 'blue', 'top').id];
    const red = [get(s, 'red', 'top').id, get(s, 'red', 'jungle').id].sort();
    return { s, o, blue, red };
  }
  const fight: ContactChoices = { 'lane-top': { blue: 'fight' } };

  test('a ganked side pushed toward the enemy tower is exposed; middle and own tower are neutral', () => {
    const score = (wave: -1 | 0 | 1) => {
      const { s, blue, red } = gank(wave);
      return resolveFight(s, d, 'top-lane', blue, red, stageOf(s), 'blue').scores;
    };
    expect(score(1).blue).toBeCloseTo(score(0).blue - W.gankExposed, 9);
    expect(score(-1).blue).toBeCloseTo(score(0).blue, 9);
    expect(score(1).red).toBeCloseTo(score(0).red, 9);
    // Without a ganked side, the wave does not matter.
    const { s, blue, red } = gank(1);
    const plain = resolveFight(s, d, 'top-lane', blue, red, stageOf(s)).scores;
    expect(plain.blue).toBeCloseTo(score(0).blue, 9);
  });

  test('a ganked laner on Push stands forward: exposed even with the wave in the middle', () => {
    const { s, blue, red } = gank(0);
    const neutral = resolveFight(s, d, 'top-lane', blue, red, stageOf(s), 'blue').scores;
    get(s, 'blue', 'top').stance = 'push';
    const pushed = resolveFight(s, d, 'top-lane', blue, red, stageOf(s), 'blue').scores;
    expect(pushed.blue).toBeCloseTo(neutral.blue - W.gankExposed, 9);
    // Under its own tower, Push only brings it back to neutral.
    s.waves.top = -1;
    expect(resolveFight(s, d, 'top-lane', blue, red, stageOf(s), 'blue').scores.blue).toBeCloseTo(neutral.blue, 9);
  });

  test('exposure changes the outcome: the same gank kills only when the laner is pushed up', () => {
    const run = (wave: -1 | 0 | 1) => {
      const { s, o, blue, red } = gank(wave);
      // Red wins by just under one death at a neutral wave.
      s.waves.top = 0;
      setGap(s, get(s, 'blue', 'top'), 'top-lane', blue, red, -(W.deathGap - W.gankExposed / 2), 'blue');
      s.waves.top = wave;
      return { s, ...resolveRound(s, d, o, fight) };
    };
    const neutral = run(0);
    expect(neutral.events.some((e) => e.type === 'death')).toBe(false);
    const exposed = run(1);
    expect(exposed.events.filter((e) => e.type === 'death').map((e) => (e as { champion: string }).champion)).toEqual([
      get(exposed.s, 'blue', 'top').id,
    ]);
  });

  test('a fought gank that kills nobody costs the ganked gankHpLoss (not survivorLoss on top)', () => {
    const { s, o, blue, red } = gank(0);
    setGap(s, get(s, 'blue', 'top'), 'top-lane', blue, red, -W.deathGap / 2, 'blue');
    const { state, events } = resolveRound(s, d, o, fight);
    expect(events.some((e) => e.type === 'fight' && e.winner === 'red')).toBe(true);
    expect(events.some((e) => e.type === 'death')).toBe(false);
    expect(get(state, 'blue', 'top').hp).toBe(H.max - W.gankHpLoss);
  });

  test('a gank with no kill costs the ganked 50 HP and sends the wave to its tower; with a kill it behaves as before', () => {
    expect(W.gankHpLoss).toBe(50);
    const { s, o, blue, red } = gank(0);
    setGap(s, get(s, 'blue', 'top'), 'top-lane', blue, red, -W.deathGap / 2, 'blue');
    const r = resolveRound(s, d, o, fight);
    expect(get(r.state, 'blue', 'top').hp).toBe(H.max - 50);
    expect(r.state.waves.top).toBe(-1);
    expect(r.events).toContainEqual({ type: 'wave', lane: 'top', from: 0, to: -1 });
    // A gank that kills: no plate, no extra damage on the tower.
    const k = gank(-1);
    setGap(k.s, get(k.s, 'blue', 'top'), 'top-lane', k.blue, k.red, -W.deathGap * 2, 'blue');
    const kt = k.s.towers['top-t1-blue']!;
    const kr = resolveRound(k.s, d, k.o, fight);
    expect(kr.events.some((e) => e.type === 'death')).toBe(true);
    expect(kr.state.towers['top-t1-blue']).toBe(kt);
  });

  test('a gank with no kill sends a wave on the gankers\' side straight to the ganked tower', () => {
    const { s, o, blue, red } = gank(1);
    setGap(s, get(s, 'blue', 'top'), 'top-lane', blue, red, -W.deathGap / 2, 'blue');
    const r = resolveRound(s, d, o, fight);
    expect(r.events.some((e) => e.type === 'death')).toBe(false);
    expect(r.state.waves.top).toBe(-1);
    expect(r.events).toContainEqual({ type: 'wave', lane: 'top', from: 1, to: -1 });
  });

  test('a ganked laner farming under its tower still pays the failed-gank price', () => {
    const s = setup([
      ['blue', 'top', 'top-t1-blue'],
      ['red', 'top', 'top-t1-red'],
      ['red', 'jungle', 'scuttle-top'],
    ]);
    s.waves.top = 0;
    const bt = get(s, 'blue', 'top');
    const o = ordersWith(s, [
      { kind: 'move', champion: bt.id, to: 'top-t1-blue' },
      { kind: 'move', champion: get(s, 'red', 'top').id, to: 'top-t1-blue' },
      { kind: 'move', champion: get(s, 'red', 'jungle').id, to: 'top-t1-blue' },
    ]);
    const blue = [bt.id];
    const red = [get(s, 'red', 'top').id, get(s, 'red', 'jungle').id].sort();
    setGap(s, bt, 'top-t1-blue', blue, red, -d.aiTuning.allInMargin / 2, 'blue');
    const r = resolveRound(s, d, o, { 'lane-top': { blue: 'farm' } });
    expect(r.events.some((e) => e.type === 'death')).toBe(false);
    expect(get(r.state, 'blue', 'top').hp).toBe(H.max - W.gankHpLoss);
    expect(r.state.waves.top).toBe(-1);
  });

  test('a gank with no kill while the wave is already at the tower takes a plate, with gold before 14:00', () => {
    const run = (round: number) => {
      const { s, o } = gank(-1);
      s.round = round;
      const tower = s.towers['top-t1-blue']!;
      const gold = get(s, 'red', 'jungle').goldEarned + get(s, 'red', 'top').goldEarned;
      const r = resolveRound(s, d, o, { 'lane-top': { blue: 'flee' } });
      return { r, tower, gold };
    };
    const early = run(10);
    expect(early.r.state.waves.top).toBe(-1);
    expect(early.r.state.towers['top-t1-blue']).toBe(early.tower - 1);
    expect(early.r.state.platesTaken.red).toBe(1);
    const earned = (x: ReturnType<typeof run>): number =>
      get(x.r.state, 'red', 'jungle').goldEarned + get(x.r.state, 'red', 'top').goldEarned - x.gold;
    const late = run(45);
    expect(late.r.state.towers['top-t1-blue']).toBe(late.tower - 1);
    expect(late.r.state.platesTaken.red).toBe(1);
    // Plate gold only before 14:00 (farm and passive income differ by round, so compare the plate part).
    expect(earned(early) - earned(late)).toBeGreaterThanOrEqual(d.rules.towers.plateGold - 1);
  });

  test('fleeing a committed gank still costs gankHpLoss; nothing if the ganker backs off too', () => {
    const { s, o } = gank(0);
    const fled = resolveRound(s, d, o, { 'lane-top': { blue: 'flee' } }).state;
    expect(get(fled, 'blue', 'top').hp).toBe(H.max - W.gankHpLoss);
    const both = resolveRound(s, d, o, { 'lane-top': { blue: 'flee', red: 'flee' } }).state;
    expect(get(both, 'blue', 'top').hp).toBe(H.max);
  });
});

describe('surviving losers retreat like a flee', () => {
  test('a Dragon fight won with a small gap: the losers leave, a plain fight winner does not start the capture', () => {
    // redbuff-blue is 1 step from the pit, so blue has a step left, but only the objective choice starts a capture.
    const s = setup([
      ['blue', 'jungle', 'redbuff-blue'],
      ['red', 'jungle', 'raptors-red'],
    ]);
    s.round = 11; // Dragon is up
    const bj = get(s, 'blue', 'jungle');
    const rj = get(s, 'red', 'jungle');
    setGap(s, bj, 'dragon-pit', [bj.id], [rj.id], W.deathGap * 0.5);
    const o = ordersWith(s, [
      { kind: 'move', champion: bj.id, to: 'dragon-pit' },
      { kind: 'move', champion: rj.id, to: 'dragon-pit' },
    ]);
    const { state, events } = resolveRound(s, d, o, { 'river-bot': { blue: 'fight', red: 'fight' } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'fight', position: 'dragon-pit', winner: 'blue' }));
    expect(events.some((e) => e.type === 'death')).toBe(false);
    expect(byId(state, rj.id)).toMatchObject({ status: 'alive', position: 'raptors-red' });
    expect(events).toContainEqual({ type: 'fled', champion: rj.id, to: 'raptors-red' });
    expect(byId(state, bj.id).position).toBe('dragon-pit');
    expect(state.pits['dragon-pit'].capture).toBeNull();
    expect(events.some((e) => e.type === 'objectiveStarted')).toBe(false);
  });

  test('an invade lost without a death: the invader leaves the camp', () => {
    const s = setup([
      ['blue', 'jungle', 'dragon-pit'],
      ['red', 'jungle', 'krugs-red'],
    ]);
    const bj = get(s, 'blue', 'jungle');
    const rj = get(s, 'red', 'jungle');
    setGap(s, bj, 'krugs-red', [bj.id], [rj.id], -W.deathGap * 0.5);
    const o = ordersWith(s, [
      { kind: 'move', champion: bj.id, to: 'krugs-red' },
      { kind: 'move', champion: rj.id, to: 'krugs-red' },
    ]);
    const { state, events } = resolveRound(s, d, o, { 'krugs-red': { blue: 'fight', red: 'fight' } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'fight', position: 'krugs-red', winner: 'red' }));
    expect(byId(state, bj.id)).toMatchObject({ status: 'alive', position: 'dragon-pit' });
    expect(byId(state, rj.id).position).toBe('krugs-red');
  });

  test('an even-lane All-in lost without a death: the losers retreat one step, and the tower can be hit next round', () => {
    const s = setup([
      ['blue', 'adc', 'bot-lane'],
      ['blue', 'support', 'bot-lane'],
      ['red', 'adc', 'bot-lane'],
      ['red', 'support', 'bot-lane'],
    ]);
    s.waves.bot = 0;
    for (const c of s.champions) if (c.role === 'adc' || c.role === 'support') c.stance = 'allin';
    const ids = (side: string) => ['adc', 'support'].map((r) => get(s, side, r).id).sort();
    setGap(s, get(s, 'blue', 'adc'), 'bot-lane', ids('blue'), ids('red'), W.deathGap * 0.5);
    const { state, events } = resolveRound(s, d, ordersWith(s), {});
    expect(events.some((e) => e.type === 'death')).toBe(false);
    for (const id of ids('red')) expect(byId(state, id)).toMatchObject({ status: 'alive', position: 'bot-t1-red' });
    for (const id of ids('blue')) expect(byId(state, id).position).toBe('bot-lane');
    // Next round the winners step onto the enemy T1, which the losers left (a lane zone would meet them anywhere in it).
    const hp = state.towers['bot-t1-red']!;
    const red = ids('red').map((id) => ({ kind: 'move' as const, champion: id, to: 'gromp-red' }));
    const blue = ids('blue').map((id) => ({ kind: 'move' as const, champion: id, to: 'bot-t1-red' }));
    const next = resolveRound(state, d, ordersWith(state, [...red, ...blue]), {});
    expect(next.state.towers['bot-t1-red']!).toBeLessThan(hp);
  });
});
