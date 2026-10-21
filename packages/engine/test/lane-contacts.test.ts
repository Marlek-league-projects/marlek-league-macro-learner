import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { defaultOrders, detectContacts, newGame, resolveRound, validateOrders } from '@lml/engine';
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

  test('a 2v1 left by a roaming support is lane pressure: no prompt, nobody dies, the wave is pushed', () => {
    const s = roamed();
    const o = ordersWith(s);
    const c = detectContacts(s, d, o).find((x) => x.position === 'bot-lane')!;
    expect(c.kind).toBe('pressure');
    expect(c.auto).toBe(true);
    expect(c.options).toEqual({ blue: ['farm'], red: ['farm'] });
    const { state, events } = resolveRound(s, d, o, {});
    expect(events.some((e) => e.type === 'fight' || e.type === 'death' || e.type === 'fled')).toBe(false);
    expect(alive(state, get(s, 'red', 'adc').id)).toBe(true);
    expect(state.waves.bot).toBe(1);
  });

  test('the smaller side cannot answer a pressure contact', () => {
    const s = roamed();
    expect(() => resolveRound(s, d, ordersWith(s), { 'bot-lane': { red: 'flee' } })).toThrow(/not allowed/);
  });

  test('pressure kills the lone laner only when the bigger side is All-in and wins by more than allInMargin', () => {
    const s = roamed();
    get(s, 'blue', 'adc').bonusLead += 100_000;
    const ra = get(s, 'red', 'adc').id;
    const allIn: Order[] = ['adc', 'support'].map((r) => ({
      kind: 'move', champion: get(s, 'blue', r).id, to: 'bot-lane', stance: 'allin',
    }));
    const o = ordersWith(s, allIn);
    expect(detectContacts(s, d, o).find((x) => x.position === 'bot-lane')!.options.blue).toEqual(['fight']);
    const won = resolveRound(s, d, o, {});
    expect(won.events.some((e) => e.type === 'fight' && e.winner === 'blue')).toBe(true);
    expect(alive(won.state, ra)).toBe(false);

    const strict = { ...d, aiTuning: { ...d.aiTuning, allInMargin: 1_000_000 } };
    const safe = resolveRound(s, strict, o, {});
    expect(safe.events.some((e) => e.type === 'fight' || e.type === 'death')).toBe(false);
    expect(alive(safe.state, ra)).toBe(true);
    expect(safe.state.waves.bot).toBe(1);
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
    const c = detectContacts(s, d, ordersWith(s, [back])).find((x) => x.position === 'bot-lane')!;
    expect(c.kind).toBe('pressure');
    expect(c.auto).toBe(true);
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
    const { max, tradeLoss, tradeWinnerLoss, regenPerRound } = d.rules.health;
    expect(get(state, 'red', 'top').hp).toBe(max - tradeLoss + regenPerRound);
    expect(get(state, 'blue', 'top').hp).toBe(Math.min(max, max - tradeWinnerLoss + regenPerRound));
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

  test('a side with mixed stances (farm + All-in) plays its most aggressive one; a losing Farm laner survives', () => {
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
    expect(rs.hp).toBe(d.rules.health.max - d.rules.health.tradeLoss + d.rules.health.regenPerRound);
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
    expect(ba.hp).toBe(d.rules.health.max - d.rules.health.tradeLoss + d.rules.health.regenPerRound);
    expect(events.some((e) => e.type === 'death' && e.champion === ba.id)).toBe(false);
    expect(alive(state, get(s, 'blue', 'support').id)).toBe(false);
    expect(alive(state, get(s, 'red', 'adc').id) && alive(state, get(s, 'red', 'support').id)).toBe(true);
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
    expect(events).toContainEqual({ type: 'moved', champion: bt, from: 'top-lane', to: 'top-t1-blue' });
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
