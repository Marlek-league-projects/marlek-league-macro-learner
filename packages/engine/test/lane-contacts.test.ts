import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { defaultOrders, detectContacts, newGame, resolveRound, roundWindow, validateOrders } from '@lml/engine';
import type { ChampionState, GameState, Order, Orders } from '@lml/engine/contracts';

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
const alive = (s: GameState, id: string): boolean => s.champions.find((c) => c.id === id)!.status === 'alive';

describe('gank or lane pressure', () => {
  /** Bot 2v1 on bot-lane: the red support roamed to mid, nobody arrived. */
  function roamed(): GameState {
    const s = setup(10, [
      ['blue', 'adc', 'bot-lane'],
      ['blue', 'support', 'bot-lane'],
      ['red', 'adc', 'bot-lane'],
      ['red', 'support', 'mid-lane'],
    ]);
    s.waves.bot = 0;
    return s;
  }

  test('a 2v1 left by a roaming support is prompted lane pressure: the lone laner flees by default', () => {
    const s = roamed();
    const o = ordersWith(s);
    const c = detectContacts(s, d, o).find((x) => x.id === 'lane-bot')!;
    expect(c.kind).toBe('pressure');
    expect(c.auto).toBe(false);
    expect(c.position).toBe('bot-lane');
    expect(c.options).toEqual({ blue: ['fight', 'flee'], red: ['fight', 'flee'] });
    expect(c.defaults).toEqual({ blue: 'fight', red: 'flee' });
    const { state, events } = resolveRound(s, d, o, {});
    const ra = get(s, 'red', 'adc').id;
    expect(events).toContainEqual({ type: 'fled', champion: ra, to: 'bot-t1-red' });
    expect(alive(state, ra)).toBe(true);
    // Fleeing a side that fights while outnumbered (not a gank) costs fleeHpLoss.
    expect(get(state, 'red', 'adc').hp).toBe(d.rules.health.max - d.rules.fight.fleeHpLoss);
  });

  test('the smaller side away from its tower cannot farm', () => {
    const s = roamed();
    expect(() => resolveRound(s, d, ordersWith(s), { 'lane-bot': { red: 'farm' } })).toThrow(/not allowed/);
  });

  /** Lone red adc on its own T1 against the blue duo. */
  function underTower(): GameState {
    const s = setup(10, [
      ['blue', 'adc', 'bot-lane'],
      ['blue', 'support', 'bot-lane'],
      ['red', 'adc', 'bot-t1-red'],
      ['red', 'support', 'raptors-red'],
    ]);
    s.waves.bot = 1;
    return s;
  }
  /** The blue duo stays on the lane middle (instead of following the wave onto the red T1). */
  const duoStays = (s: GameState): Orders =>
    ordersWith(s, ['adc', 'support'].map((r) => ({ kind: 'move', champion: get(s, 'blue', r).id, to: 'bot-lane' })));

  test('a lone adc on its T1 against 2 may farm or flee; the fight happens on its tower', () => {
    const s = underTower();
    const c = detectContacts(s, d, duoStays(s)).find((x) => x.id === 'lane-bot')!;
    expect(c.kind).toBe('pressure');
    expect(c.position).toBe('bot-t1-red');
    expect(c.positions).toEqual(['bot-lane', 'bot-t1-red']);
    expect(c.options.red).toEqual(['fight', 'flee', 'farm']);
    expect(c.options.blue).toEqual(['fight', 'flee']);
  });

  test('farming under its tower against a fight costs pressureHpLoss and nothing more when the gap is within allInMargin', () => {
    const s = underTower();
    const ra = get(s, 'red', 'adc');
    const before = ra.gold;
    const strict = { ...d, aiTuning: { ...d.aiTuning, allInMargin: 1_000_000 } };
    const { state, events } = resolveRound(s, strict, duoStays(s), { 'lane-bot': { red: 'farm' } });
    expect(events.some((e) => e.type === 'fight' || e.type === 'death' || e.type === 'fled')).toBe(false);
    expect(events).toContainEqual({ type: 'hpLost', champion: ra.id, amount: d.rules.fight.pressureHpLoss });
    const after = get(state, 'red', 'adc');
    expect([after.status, after.position, after.hp]).toEqual(['alive', 'bot-t1-red', d.rules.health.max - d.rules.fight.pressureHpLoss]);
    // The bigger side stays on the tower with it; the adc still farms, at the pressure share.
    expect(get(state, 'blue', 'adc').position).toBe('bot-t1-red');
    const win = roundWindow(d.rules, s.round);
    const farm = (d.rules.economy.farmGoldPerMin * win.seconds * d.rules.economy.pressureFarmShare) / 60;
    const passive = (d.rules.economy.passiveGoldPerMin * win.seconds) / 60;
    expect(after.gold - before).toBeCloseTo(farm + passive, 6);
  });

  test('farming under its tower dies only to a fight won by more than allInMargin', () => {
    const s = underTower();
    get(s, 'blue', 'adc').bonusLead += 100_000;
    const ra = get(s, 'red', 'adc').id;
    const { state, events } = resolveRound(s, d, duoStays(s), { 'lane-bot': { red: 'farm' } });
    expect(events.some((e) => e.type === 'fight' && e.winner === 'blue' && e.position === 'bot-t1-red')).toBe(true);
    expect(alive(state, ra)).toBe(false);
  });

  test('a laner returning to its own lane is not a ganker: the 2v1 stays lane pressure', () => {
    const s = setup(10, [
      ['blue', 'adc', 'bot-lane'],
      ['blue', 'support', 'dragon-pit'],
      ['red', 'adc', 'bot-lane'],
      ['red', 'support', 'mid-lane'],
    ]);
    s.waves.bot = 0;
    const back: Order = { kind: 'move', champion: get(s, 'blue', 'support').id, to: 'bot-lane' };
    validateOrders(s, d, 'blue', ordersWith(s, [back]).blue);
    const c = detectContacts(s, d, ordersWith(s, [back])).find((x) => x.id === 'lane-bot')!;
    expect(c.kind).toBe('pressure');
    expect(c.auto).toBe(false);
  });

  test('a jungler arriving into the lane is a gank, prompted as before', () => {
    const s = setup(10, [
      ['blue', 'adc', 'bot-lane'],
      ['red', 'adc', 'bot-lane'],
      ['blue', 'support', 'mid-lane'],
      ['red', 'support', 'mid-lane'],
      ['red', 'jungle', 'scuttle-bot'],
    ]);
    s.waves.bot = 0;
    const o = ordersWith(s, [{ kind: 'move', champion: get(s, 'red', 'jungle').id, to: 'bot-lane' }]);
    const c = detectContacts(s, d, o).find((x) => x.position === 'bot-lane')!;
    expect(c.kind).toBe('gank');
    expect(c.auto).toBe(false);
    expect(c.defaults).toEqual({ blue: 'flee', red: 'fight' });
  });
});

describe('stances', () => {
  /** Blue and red tops meet on top-lane; blue has a large lead. */
  function lane(): GameState {
    const s = setup(10, [
      ['blue', 'top', 'top-lane'],
      ['red', 'top', 'top-lane'],
    ]);
    s.waves.top = 0;
    get(s, 'blue', 'top').bonusLead += 100_000;
    return s;
  }

  test('a new champion farms by default and an even lane contact is resolved automatically', () => {
    const s = lane();
    expect(s.champions.every((c) => c.stance === 'farm')).toBe(true);
    const c = detectContacts(s, d, ordersWith(s)).find((x) => x.position === 'top-lane')!;
    expect(c.kind).toBe('trade');
    expect(c.auto).toBe(true);
    expect(c.options).toEqual({ blue: ['farm'], red: ['farm'] });
  });

  test('farm vs farm: nobody dies, no fight', () => {
    const s = lane();
    const { state, events } = resolveRound(s, d, ordersWith(s), {});
    expect(events.some((e) => e.type === 'fight' || e.type === 'death')).toBe(false);
    expect(state.champions.filter((c) => c.role === 'top').every((c) => c.status === 'alive')).toBe(true);
  });

  test('farm vs trade is a trade, nobody dies', () => {
    const s = lane();
    const rt = get(s, 'red', 'top').id;
    const { events } = resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: rt, to: 'top-lane', stance: 'trade' }]), {});
    expect(events).toContainEqual({ type: 'trade', position: 'top-lane', lane: 'top', winner: 'blue' });
    expect(events.some((e) => e.type === 'death')).toBe(false);
  });

  test('Farm plays safe: a stronger All-in against Farm only wins the trade (wave, lead, HP), nobody dies', () => {
    const s = lane();
    const bt = get(s, 'blue', 'top');
    const rt = get(s, 'red', 'top');
    const o = ordersWith(s, [{ kind: 'move', champion: bt.id, to: 'top-lane', stance: 'allin' }]);
    const c = detectContacts(s, d, o).find((x) => x.position === 'top-lane')!;
    expect(c.options).toEqual({ blue: ['fight'], red: ['farm'] });
    const { state, events } = resolveRound(s, d, o, {});
    expect(events.some((e) => e.type === 'fight' || e.type === 'death')).toBe(false);
    expect(events).toContainEqual({ type: 'trade', position: 'top-lane', lane: 'top', winner: 'blue' });
    expect(alive(state, rt.id)).toBe(true);
    expect(state.waves.top).toBe(1);
    expect(get(state, 'blue', 'top').bonusLead).toBe(bt.bonusLead + d.rules.economy.tradeLead);
    const { max, tradeLoss, tradeWinnerLoss } = d.rules.health;
    expect(get(state, 'red', 'top').hp).toBe(max - tradeLoss);
    expect(get(state, 'blue', 'top').hp).toBe(max - tradeWinnerLoss);
  });

  test('Push plays like Farm in an even lane contact: never all-in, and a Push loser against All-in survives', () => {
    const s = lane();
    const bt = get(s, 'blue', 'top');
    const rt = get(s, 'red', 'top');
    const vsFarm = ordersWith(s, [{ kind: 'move', champion: rt.id, to: 'top-lane', stance: 'push' }]);
    expect(detectContacts(s, d, vsFarm).find((x) => x.position === 'top-lane')!.options).toEqual({ blue: ['farm'], red: ['farm'] });
    const o = ordersWith(s, [
      { kind: 'move', champion: bt.id, to: 'top-lane', stance: 'allin' },
      { kind: 'move', champion: rt.id, to: 'top-lane', stance: 'push' },
    ]);
    validateOrders(s, d, 'red', o.red);
    const c = detectContacts(s, d, o).find((x) => x.position === 'top-lane')!;
    expect(c.options).toEqual({ blue: ['fight'], red: ['farm'] });
    const { state, events } = resolveRound(s, d, o, {});
    expect(events.some((e) => e.type === 'fight' || e.type === 'death')).toBe(false);
    expect(events).toContainEqual({ type: 'trade', position: 'top-lane', lane: 'top', winner: 'blue' });
    expect(alive(state, rt.id)).toBe(true);
    expect(get(state, 'red', 'top').stance).toBe('push');
  });

  test('a weaker All-in against Farm loses the trade, nobody dies', () => {
    const s = lane();
    const rt = get(s, 'red', 'top').id;
    const { state, events } = resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: rt, to: 'top-lane', stance: 'allin' }]), {});
    expect(events.some((e) => e.type === 'fight' || e.type === 'death')).toBe(false);
    expect(events).toContainEqual({ type: 'trade', position: 'top-lane', lane: 'top', winner: 'blue' });
    expect(alive(state, rt)).toBe(true);
  });

  test('Trade vs All-in is still a fight where the loser dies', () => {
    const s = lane();
    const bt = get(s, 'blue', 'top').id;
    const rt = get(s, 'red', 'top').id;
    const o = ordersWith(s, [
      { kind: 'move', champion: bt, to: 'top-lane', stance: 'allin' },
      { kind: 'move', champion: rt, to: 'top-lane', stance: 'trade' },
    ]);
    const { state, events } = resolveRound(s, d, o, {});
    expect(events.some((e) => e.type === 'fight' && e.winner === 'blue')).toBe(true);
    expect(alive(state, rt)).toBe(false);
  });

  test('a side with mixed stances (farm + All-in) plays its most aggressive one; a losing Farm laner survives and loses survivorLoss HP', () => {
    const s = setup(10, [
      ['blue', 'adc', 'bot-lane'],
      ['blue', 'support', 'bot-lane'],
      ['red', 'adc', 'bot-lane'],
      ['red', 'support', 'bot-lane'],
    ]);
    s.waves.bot = 0;
    get(s, 'blue', 'adc').bonusLead += 100_000;
    get(s, 'blue', 'support').stance = 'allin';
    get(s, 'red', 'adc').stance = 'trade';
    const c = detectContacts(s, d, ordersWith(s)).find((x) => x.position === 'bot-lane')!;
    expect(c.kind).toBe('trade');
    expect(c.options.blue).toEqual(['fight']);
    const { state, events } = resolveRound(s, d, ordersWith(s), {});
    expect(events.some((e) => e.type === 'fight' && e.winner === 'blue')).toBe(true);
    expect(alive(state, get(s, 'red', 'adc').id)).toBe(false);
    const rs = get(state, 'red', 'support');
    expect(rs.status).toBe('alive');
    expect(rs.hp).toBe(d.rules.health.max - d.rules.fight.survivorLoss);
  });

  test('2v2: a Farm adc whose All-in support loses the fight to a Trade duo survives; the support dies', () => {
    const s = setup(10, [
      ['blue', 'adc', 'bot-lane'],
      ['blue', 'support', 'bot-lane'],
      ['red', 'adc', 'bot-lane'],
      ['red', 'support', 'bot-lane'],
    ]);
    s.waves.bot = 0;
    get(s, 'red', 'adc').bonusLead += 100_000;
    get(s, 'blue', 'support').stance = 'allin';
    get(s, 'red', 'adc').stance = 'trade';
    get(s, 'red', 'support').stance = 'trade';
    const { state, events } = resolveRound(s, d, ordersWith(s), {});
    expect(events.some((e) => e.type === 'fight' && e.winner === 'red')).toBe(true);
    const ba = get(state, 'blue', 'adc');
    expect(ba.status).toBe('alive');
    expect(ba.hp).toBe(d.rules.health.max - d.rules.fight.survivorLoss);
    expect(events.some((e) => e.type === 'death' && e.champion === ba.id)).toBe(false);
    expect(alive(state, get(s, 'blue', 'support').id)).toBe(false);
    expect(alive(state, get(s, 'red', 'adc').id) && alive(state, get(s, 'red', 'support').id)).toBe(true);
  });

  test('2v2: a Push adc whose All-in support loses the fight survives like a Farm adc; the support dies', () => {
    const s = setup(10, [
      ['blue', 'adc', 'bot-lane'],
      ['blue', 'support', 'bot-lane'],
      ['red', 'adc', 'bot-lane'],
      ['red', 'support', 'bot-lane'],
    ]);
    s.waves.bot = 0;
    get(s, 'red', 'adc').bonusLead += 100_000;
    get(s, 'blue', 'adc').stance = 'push';
    get(s, 'blue', 'support').stance = 'allin';
    get(s, 'red', 'adc').stance = 'trade';
    get(s, 'red', 'support').stance = 'trade';
    const { state, events } = resolveRound(s, d, ordersWith(s), {});
    expect(events.some((e) => e.type === 'fight' && e.winner === 'red')).toBe(true);
    const ba = get(state, 'blue', 'adc');
    expect(ba.status).toBe('alive');
    expect(events.some((e) => e.type === 'death' && e.champion === ba.id)).toBe(false);
    expect(alive(state, get(s, 'blue', 'support').id)).toBe(false);
  });

  test('a stance persists across rounds until an order changes it', () => {
    const s = lane();
    const bt = get(s, 'blue', 'top').id;
    const r1 = resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: bt, to: 'top-lane', stance: 'trade' }]), {});
    expect(get(r1.state, 'blue', 'top').stance).toBe('trade');
    const r2 = resolveRound(r1.state, d, ordersWith(r1.state), {});
    expect(get(r2.state, 'blue', 'top').stance).toBe('trade');
    const r3 = resolveRound(r2.state, d, ordersWith(r2.state, [{ kind: 'move', champion: bt, to: 'top-lane', stance: 'farm' }]), {});
    expect(get(r3.state, 'blue', 'top').stance).toBe('farm');
  });

  test('an unknown stance is rejected', () => {
    const s = lane();
    const bt = get(s, 'blue', 'top').id;
    const bad = { kind: 'move', champion: bt, to: 'top-lane', stance: 'yolo' } as unknown as Order;
    expect(() => validateOrders(s, d, 'blue', ordersWith(s, [bad]).blue)).toThrow(/stance/);
  });
});

describe('move then recall', () => {
  test('a laner steps back under its tower, then recalls from there', () => {
    const s = setup(10, [['blue', 'top', 'top-lane']]);
    const bt = get(s, 'blue', 'top').id;
    const { state, events } = resolveRound(s, d, ordersWith(s, [{ kind: 'recall', champion: bt, to: 'top-t1-blue' }]), {});
    expect(events).toContainEqual({ type: 'moved', champion: bt, from: 'top-lane', to: 'top-t1-blue', acted: true });
    expect(events).toContainEqual(expect.objectContaining({ type: 'recall', champion: bt }));
    const after = get(state, 'blue', 'top');
    expect([after.status, after.position]).toEqual(['respawning', 'top-t1-blue']);
  });

  test('moving into a fight cancels the recall', () => {
    const s = setup(10, [
      ['blue', 'top', 'top-lane'],
      ['red', 'top', 'top-t1-blue'],
    ]);
    s.waves.top = -1;
    get(s, 'blue', 'top').bonusLead += 100_000;
    get(s, 'red', 'top').stance = 'allin';
    get(s, 'blue', 'top').stance = 'trade';
    const bt = get(s, 'blue', 'top').id;
    const { state, events } = resolveRound(s, d, ordersWith(s, [{ kind: 'recall', champion: bt, to: 'top-t1-blue' }]), {});
    expect(events.some((e) => e.type === 'fight' && e.winner === 'blue')).toBe(true);
    expect(events.some((e) => e.type === 'recall')).toBe(false);
    const after = get(state, 'blue', 'top');
    expect([after.status, after.position]).toEqual(['alive', 'top-t1-blue']);
  });

  test('the recall step is at most 1 move and never into the enemy base', () => {
    const s = setup(10, [['blue', 'top', 'top-lane'], ['blue', 'jungle', 'gromp-blue'], ['blue', 'mid', 'mid-t3-red']]);
    const recall = (champion: string, to: string): Order[] => ordersWith(s, [{ kind: 'recall', champion, to }]).blue;
    expect(() => validateOrders(s, d, 'blue', recall(get(s, 'blue', 'top').id, 'top-t2-blue'))).toThrow(/recall/);
    // A jungler is limited to 1 step too.
    expect(() => validateOrders(s, d, 'blue', recall(get(s, 'blue', 'jungle').id, 'top-lane'))).toThrow(/recall/);
    expect(() => validateOrders(s, d, 'blue', recall(get(s, 'blue', 'jungle').id, 'top-t1-blue'))).not.toThrow();
    expect(() => validateOrders(s, d, 'blue', recall(get(s, 'blue', 'mid').id, 'base-red'))).toThrow(/recall/);
  });
});

describe('flee direction and gank outcome', () => {
  test('a flee never ends farther from the own base than where the champion stood', () => {
    // 2v2 top skirmish: blue top on its T2 (behind the fight), blue jungler in the lane, both reds on the blue-side T1.
    const s = setup(7, [
      ['blue', 'top', 'top-t2-blue'], ['blue', 'jungle', 'top-lane'],
      ['red', 'top', 'top-t1-red'], ['red', 'mid', 'top-t1-red'],
    ]);
    const o = ordersWith(s, s.champions.map((c) => ({ kind: 'move', champion: c.id, to: c.position }) as Order));
    const c = detectContacts(s, d, o).find((x) => x.id === 'lane-top')!;
    const before = new Map(s.champions.map((x) => [x.id, d.graph.distance(x.position, `base-${x.side}`)]));
    const { events, state } = resolveRound(s, d, o, { [c.id]: { blue: 'flee', red: 'fight' } });
    const fled = events.filter((e) => e.type === 'fled');
    expect(fled.length).toBeGreaterThan(0);
    for (const e of fled) {
      if (e.type !== 'fled') continue;
      const ch = state.champions.find((x) => x.id === e.champion)!;
      expect(d.graph.distance(e.to, `base-${ch.side}`)).toBeLessThanOrEqual(before.get(ch.id)!);
    }
  });

  test('a gank that kills (the ganked laner fleeing to 0 HP) does not trigger the failed-gank wave rule', () => {
    const s = setup(10, [['blue', 'top', 'top-lane'], ['red', 'top', 'top-lane'], ['blue', 'jungle', 'scuttle-top']]);
    get(s, 'red', 'top').hp = d.rules.fight.gankHpLoss;
    s.waves.top = -1;
    const stay = s.champions.filter((c) => c.role !== 'jungle' || c.side !== 'blue').map((c) => ({ kind: 'move', champion: c.id, to: c.position }) as Order);
    const o = ordersWith(s, [{ kind: 'move', champion: get(s, 'blue', 'jungle').id, to: 'top-lane' }, ...stay]);
    const c = detectContacts(s, d, o).find((x) => x.id === 'lane-top')!;
    expect(c.kind).toBe('gank');
    const r = resolveRound(s, d, o, { [c.id]: { blue: 'fight', red: 'flee' } });
    expect(r.events.some((e) => e.type === 'death' && e.champion === get(s, 'red', 'top').id)).toBe(true);
    // A failed gank would jump the wave to the ganked side's tower (+1); a kill leaves the normal one-step move.
    expect(r.state.waves.top).toBe(0);
  });
});
