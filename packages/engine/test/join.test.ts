import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import type { AiProfile, Rank } from '@lml/data/contracts';
import {
  aiAnswers,
  aiContactChoice,
  aiJoins,
  defaultOrders,
  detectContacts,
  newGame,
  resolveJoins,
  resolveRound,
  roundWindow,
  viewFor,
  withJoiners,
} from '@lml/engine';
import type { ChampionState, Contact, ContactChoices, GameState, Order, Orders, Rng } from '@lml/engine/contracts';

const d = loadGameData();
const get = (s: GameState, side: string, role: string): ChampionState =>
  s.champions.find((c) => c.side === side && c.role === role)!;
const profile = (rank: Rank): AiProfile => d.aiProfiles.find((p) => p.rank === rank)!;
const stubRng = (v: number): Rng => ({ next: () => v, int: (k) => Math.floor(v * k), pick: (xs) => xs[Math.floor(v * xs.length)]!, state: () => 0 });

function setup(round: number, place: Array<[string, string, string]>): GameState {
  const s = newGame(d, 7);
  s.round = round;
  for (const [side, role, pos] of place) {
    const c = get(s, side, role);
    c.position = pos;
    c.previous = pos;
  }
  // No Scuttle to take in the bot river: the contact is only a fight.
  s.scuttles['scuttle-bot'] = 99_999;
  s.scuttlesSeen.blue['scuttle-bot'] = 99_999;
  s.scuttlesSeen.red['scuttle-bot'] = 99_999;
  return s;
}
const stayOn = (c: ChampionState): Order => ({ kind: 'move', champion: c.id, to: c.position });
const ordersWith = (s: GameState, over: Order[] = []): Orders => {
  const f = (side: 'blue' | 'red'): Order[] =>
    defaultOrders(s, d, side).map((o) => over.find((x) => x.champion === o.champion) ?? o);
  return { blue: f('blue'), red: f('red') };
};

/**
 * Round 7, the bot river: the blue and red junglers meet on the bot Scuttle (river-bot). The blue mid stands on its
 * Krugs (1 step from the Scuttle, camp up), the red mid on its mid T1 (1 step too).
 */
function river(): { s: GameState; o: Orders; bj: ChampionState; bm: ChampionState; rj: ChampionState; rm: ChampionState } {
  const s = setup(7, [
    ['blue', 'jungle', 'scuttle-bot'],
    ['red', 'jungle', 'scuttle-bot'],
    ['blue', 'mid', 'krugs-blue'],
    ['red', 'mid', 'mid-t1-red'],
  ]);
  const [bj, bm, rj, rm] = [get(s, 'blue', 'jungle'), get(s, 'blue', 'mid'), get(s, 'red', 'jungle'), get(s, 'red', 'mid')];
  return { s, o: ordersWith(s, [stayOn(bj), stayOn(rj), stayOn(bm), stayOn(rm)]), bj, bm, rj, rm };
}

describe('nearby champions (join a fight 1 step away)', () => {
  test('alive, in no contact, not recalling, arrived 1 step from a contact position', () => {
    const { s, o, bm, rm } = river();
    const bt = get(s, 'blue', 'top');
    const bs = get(s, 'blue', 'support');
    // The blue top is dead next to the Scuttle; the blue support walks next to it to recall.
    bt.status = 'dead';
    bt.position = 'raptors-blue';
    o.blue = o.blue.filter((x) => x.champion !== bt.id);
    o.blue = o.blue.map((x) => (x.champion === bs.id ? { kind: 'recall', champion: bs.id, to: 'redbuff-blue' } : x));
    const c = detectContacts(s, d, o).find((x) => x.id === 'river-bot')!;
    expect(c.auto).toBe(false);
    expect(c.nearby).toEqual({ blue: [bm.id], red: [rm.id] });
    // The blue adc stands on the bot T1, 1 step from the Scuttle, but is in the bot lane contact.
    const ba = get(s, 'blue', 'adc');
    expect(detectContacts(s, d, o).some((x) => x.id === 'lane-bot' && x.blue.includes(ba.id))).toBe(true);
    expect(c.nearby.blue).not.toContain(ba.id);
  });

  test('automatic standard-laning contacts offer no join', () => {
    const s = setup(7, [['blue', 'top', 'top-lane'], ['red', 'top', 'top-lane'], ['blue', 'jungle', 'scuttle-top']]);
    const bj = get(s, 'blue', 'jungle');
    const o = ordersWith(s, [stayOn(bj)]);
    const lane = detectContacts(s, d, o).find((x) => x.id === 'lane-top')!;
    expect(lane.auto).toBe(true);
    expect(lane.nearby).toEqual({ blue: [], red: [] });
  });

  test('a join must come from the contact nearby list, and a champion joins one contact at most', () => {
    const { s, o, bm, rj } = river();
    expect(() => resolveRound(s, d, o, { 'river-bot': { joins: { blue: [rj.id] } } })).toThrow();
    const c = detectContacts(s, d, o).find((x) => x.id === 'river-bot')!;
    const choices: ContactChoices = { 'river-bot': { joins: { blue: [bm.id] } } };
    expect(resolveJoins(c, choices)).toEqual({ blue: [bm.id], red: [] });
    expect(resolveJoins(c, choices, new Set([bm.id]))).toEqual({ blue: [], red: [] });
  });
});

describe('resolving a joined fight', () => {
  test('a joiner turns a lost fight into a won one and forfeits its action (its camp is not cleared)', () => {
    const { s, o, bj, bm, rj } = river();
    bj.hp = 30;
    const fight = { blue: 'fight', red: 'fight' } as const;
    const alone = resolveRound(s, d, o, { 'river-bot': fight });
    const lost = alone.events.find((e) => e.type === 'fight')!;
    expect(lost.type === 'fight' && lost.winner).toBe('red');
    expect(alone.events).toContainEqual({ type: 'campCleared', camp: 'krugs-blue', champion: bm.id });

    const joined = resolveRound(s, d, o, { 'river-bot': { ...fight, joins: { blue: [bm.id] } } });
    const won = joined.events.find((e) => e.type === 'fight')!;
    expect(won).toMatchObject({ type: 'fight', winner: 'blue', blue: [bj.id, bm.id].sort(), red: [rj.id] });
    expect(joined.events).toContainEqual({ type: 'joined', champion: bm.id, side: 'blue', from: 'krugs-blue', position: 'scuttle-bot' });
    expect(joined.events.some((e) => e.type === 'campCleared' && e.camp === 'krugs-blue')).toBe(false);
    expect(joined.state.camps['krugs-blue']).toBe(s.camps['krugs-blue']);
    const mid = joined.state.champions.find((c) => c.id === bm.id)!;
    expect(mid.position).toBe('scuttle-bot');
    // Seen in the contact like any participant.
    expect(joined.state.met.red[bm.id]).toMatchObject({ round: 7, position: 'scuttle-bot' });
  });

  test('a 0 HP kill credits the joiner too', () => {
    const { s, o, bj, rj, rm } = river();
    bj.hp = 10;
    const before = { rj: rj.gold, rm: rm.gold };
    const { state, events } = resolveRound(s, d, o, { 'river-bot': { blue: 'flee', red: 'fight', joins: { red: [rm.id] } } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'death', champion: bj.id }));
    expect(state.kills.red).toBe(s.kills.red + 1);
    const gain = (id: string, was: number): number => state.champions.find((c) => c.id === id)!.gold - was;
    // Half the kill each, on top of the round's passive gold.
    const passive = (d.rules.economy.passiveGoldPerMin * roundWindow(d.rules, 7).seconds) / 60;
    expect(gain(rm.id, before.rm)).toBe(d.rules.economy.killGold / 2 + passive);
    expect(gain(rj.id, before.rj)).toBe(d.rules.economy.killGold / 2 + passive);
  });

  test('a lane contact follows the new numbers: a jungler joining the bigger side makes a gank, evening them a skirmish', () => {
    // Red top and red mid already in the top lane: lane pressure on the blue top, nobody arrived.
    const s = setup(7, [
      ['blue', 'top', 'top-lane'], ['red', 'top', 'top-lane'], ['red', 'mid', 'top-lane'],
      ['blue', 'jungle', 'scuttle-top'], ['red', 'jungle', 'baron-pit'],
    ]);
    const o = ordersWith(s, s.champions.map(stayOn));
    const c = detectContacts(s, d, o).find((x) => x.id === 'lane-top')!;
    expect(c.kind).toBe('pressure');
    const [bj, rj] = [get(s, 'blue', 'jungle'), get(s, 'red', 'jungle')];
    expect(withJoiners(s, d, c, { blue: [bj.id] }).kind).toBe('skirmish');
    expect(withJoiners(s, d, c, { red: [rj.id] }).kind).toBe('gank');
  });
});

describe('AI join decision', () => {
  /** Blue's view of the river contact, its jungler at `bjHp` and the red jungler at `rjHp`. */
  function blueSide(bjHp: number, rjHp: number): { view: ReturnType<typeof viewFor>; c: Contact; bm: ChampionState } {
    const { s, o, bj, bm, rj } = river();
    bj.hp = bjHp;
    rj.hp = rjHp;
    const c = detectContacts(s, d, o).find((x) => x.id === 'river-bot')!;
    return { view: viewFor(s, d, 'blue'), c, bm };
  }

  test('Challenger joins only when it turns a lost or tied fight into a won one', () => {
    const lost = blueSide(30, 100);
    expect(aiJoins(lost.view, d, lost.c, profile('challenger'), stubRng(0.99))).toEqual([lost.bm.id]);
    // Joined, it fights; alone it would flee.
    expect(aiContactChoice(lost.view, d, lost.c, profile('challenger'), stubRng(0.99))).toBe('flee');
    expect(aiContactChoice(lost.view, d, lost.c, profile('challenger'), stubRng(0.99), [lost.bm.id])).toBe('fight');
    const won = blueSide(100, 20);
    expect(aiJoins(won.view, d, won.c, profile('challenger'), stubRng(0.99))).toEqual([]);
    // Already taken by another contact: not offered again.
    expect(aiJoins(lost.view, d, lost.c, profile('challenger'), stubRng(0.99), new Set([lost.bm.id]))).toEqual([]);
  });

  test('a hopeless fight: stays out (even all joiners would not win it)', () => {
    const { s, bm } = river();
    // Red brings its top, adc and support onto the Scuttle too: 1 + 1 against 4 (the blue duo is back in base).
    for (const role of ['top', 'adc', 'support']) {
      const c = get(s, 'red', role);
      c.position = 'scuttle-bot';
      c.previous = 'scuttle-bot';
    }
    for (const role of ['adc', 'support']) {
      const c = get(s, 'blue', role);
      c.position = 'base-blue';
      c.previous = 'base-blue';
    }
    const all = ordersWith(s, s.champions.map(stayOn));
    const c = detectContacts(s, d, all).find((x) => x.id === 'river-bot')!;
    expect(c.nearby.blue).toEqual([bm.id]);
    expect(aiJoins(viewFor(s, d, 'blue'), d, c, profile('challenger'), stubRng(0.99))).toEqual([]);
  });

  test('the joinFight mistake inverts the decision at its probability', () => {
    const forced: AiProfile = { ...profile('challenger'), mistakes: { ...profile('challenger').mistakes, joinFight: 1 } };
    const lost = blueSide(30, 100);
    expect(aiJoins(lost.view, d, lost.c, forced, stubRng(0.5))).toEqual([]);
    const won = blueSide(100, 20);
    expect(aiJoins(won.view, d, won.c, forced, stubRng(0.5))).toEqual([won.bm.id]);
    // Rolled under the rank's own probability: 0 < 0.01 for Challenger too.
    expect(aiJoins(lost.view, d, lost.c, profile('challenger'), stubRng(0))).toEqual([]);
    expect(d.aiProfiles.every((p) => typeof p.mistakes.joinFight === 'number')).toBe(true);
    expect(profile('iron').mistakes.joinFight).toBeGreaterThan(profile('challenger').mistakes.joinFight);
  });

  test('aiAnswers: joiners first, then the choice with them; a champion joins one contact at most', () => {
    const lost = blueSide(30, 100);
    const answers = aiAnswers(lost.view, d, [lost.c], profile('challenger'), stubRng(0.99));
    expect(answers['river-bot']).toEqual({ blue: 'fight', joins: { blue: [lost.bm.id] } });
  });
});
