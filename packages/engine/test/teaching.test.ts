import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { defaultOrders, explainRound, newGame, resolveRound } from '@lml/engine';
import { TEACHING_PREDICATE_IDS } from '../src/teaching';
import type { ChampionState, GameEvent, GameState, Order, Orders } from '@lml/engine/contracts';

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

describe('teaching', () => {
  test('every teaching id has a predicate and every predicate an id', () => {
    expect([...TEACHING_PREDICATE_IDS].sort()).toEqual(d.teaching.map((r) => r.id).sort());
  });

  test('carapateur 1v2 death explains outnumbered-death for blue', () => {
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
    const { state, events } = resolveRound(s, d, o, { 'river-bot': { blue: 'fight' } });
    const out = explainRound(s, state, events, d, 'blue');
    const e = out.find((x) => x.ruleId === 'outnumbered-death')!;
    expect(e.roundsLost).toBe(1);
    expect(e.text).toContain('2v1');
    expect(e.text).toContain('Carapateur bas');
    expect(e.text).toContain(d.champions[get(s, 'blue', 'jungle').id]!.name);
  });

  test('recall with the top wave at -1 for blue loses 2 rounds', () => {
    const s = newGame(d, 3);
    s.waves.top = -1;
    const bt = get(s, 'blue', 'top');
    const o = ordersWith(s, [{ kind: 'recall', champion: bt.id }]);
    const { state, events } = resolveRound(s, d, o, {});
    const out = explainRound(s, state, events, d, 'blue');
    const e = out.find((x) => x.ruleId === 'recall-wave-under-tower')!;
    expect(e.roundsLost).toBe(2);
    expect(e.text).toContain(d.champions[bt.id]!.name);
    expect(explainRound(s, state, events, d, 'red').some((x) => x.ruleId === 'recall-wave-under-tower')).toBe(false);
  });

  test('an uncontested enemy objective is reported; a fought one is not', () => {
    const s = newGame(d, 3);
    const taken: GameEvent = { type: 'objectiveTaken', objective: 'dragon', side: 'red', position: 'dragon-pit', champions: [] };
    const fight: GameEvent = { type: 'fight', position: 'dragon-pit', blue: [], red: [], winner: 'red', scores: { blue: 0, red: 1 } };
    const quiet = explainRound(s, s, [taken], d, 'blue').find((x) => x.ruleId === 'objective-uncontested');
    expect(quiet?.text).toBe("L'adversaire a pris le Dragon sans opposition.");
    expect(explainRound(s, s, [fight, taken], d, 'blue').some((x) => x.ruleId === 'objective-uncontested')).toBe(false);
  });
  /** Blue mid leaves mid-t1-blue for `to` in `round`, its wave at its own tower. */
  function midLeaves(round: number, to: string): { s: GameState; state: GameState; events: GameEvent[] } {
    const s = setup(round, [['blue', 'mid', 'mid-t1-blue']]);
    s.waves.mid = -1;
    s.scuttles['scuttle-bot'] = 10_000; // taken earlier, and blue saw it
    s.scuttlesSeen.blue['scuttle-bot'] = 10_000;
    const o = ordersWith(s, [{ kind: 'move', champion: get(s, 'blue', 'mid').id, to }]);
    return { s, ...resolveRound(s, d, o, {}) };
  }
  const ids = (out: Array<{ ruleId: string }>): string[] => out.map((x) => x.ruleId);

  test('leaving an unpushed lane toward a live Dragon is a wave sacrifice, not a mistake', () => {
    // Dragon spawned in round 13; scuttle-bot is the mid's first step toward the pit.
    const { s, state, events } = midLeaves(14, 'scuttle-bot');
    expect(state.pits['dragon-pit'].objective).toBe('dragon');
    const out = explainRound(s, state, events, d, 'blue');
    expect(ids(out)).toContain('wave-sacrifice-for-objective');
    expect(ids(out)).not.toContain('left-lane-without-priority');
    const e = out.find((x) => x.ruleId === 'wave-sacrifice-for-objective')!;
    expect(e.roundsLost).toBe(0);
    expect(e.text).toBe(`${d.champions[get(s, 'blue', 'mid').id]!.name} a sacrifié sa vague pour jouer le Dragon : bon échange si ça donne le surnombre.`);
  });

  test('stepping toward the Dragon the round before it spawns is the setup, not a mistake', () => {
    // Round 12: the Dragon spawns at 300 s, in round 13.
    const { s, state, events } = midLeaves(12, 'scuttle-bot');
    expect(state.pits['dragon-pit'].objective).toBeNull();
    const out = explainRound(s, state, events, d, 'blue');
    expect(ids(out)).toContain('wave-sacrifice-for-objective');
    expect(ids(out)).not.toContain('left-lane-without-priority');
    expect(out.find((x) => x.ruleId === 'wave-sacrifice-for-objective')!.text).toContain('le Dragon');
  });

  test('leaving an unpushed lane for a camp is still a mistake', () => {
    const { s, state, events } = midLeaves(14, 'raptors-blue');
    const out = explainRound(s, state, events, d, 'blue');
    expect(ids(out)).toContain('left-lane-without-priority');
    expect(ids(out)).not.toContain('wave-sacrifice-for-objective');
  });

  test('leaving for a scuttle with nothing up there or next to it is still a mistake', () => {
    // Round 7: the Dragon is two rounds or more away; the bot scuttle is down until much later.
    const s = setup(7, [['blue', 'mid', 'mid-t1-blue']]);
    s.waves.mid = -1;
    s.scuttles['scuttle-bot'] = 10_000;
    s.scuttlesSeen.blue['scuttle-bot'] = 10_000;
    const o = ordersWith(s, [{ kind: 'move', champion: get(s, 'blue', 'mid').id, to: 'scuttle-bot' }]);
    const { state, events } = resolveRound(s, d, o, {});
    const out = explainRound(s, state, events, d, 'blue');
    expect(ids(out)).toContain('left-lane-without-priority');
    expect(ids(out)).not.toContain('wave-sacrifice-for-objective');
  });

  test('a wave sacrifice is only explained from events the side saw', () => {
    // Red never sees the blue mid's lessons; a scuttle take blue did not see does not justify the move.
    const { s, state, events } = midLeaves(12, 'scuttle-bot');
    expect(ids(explainRound(s, state, events, d, 'red'))).not.toContain('wave-sacrifice-for-objective');
    // Blue believes the bot scuttle is down; red takes it while the blue mid, chased off, is back on its tower.
    const b = setup(7, [['blue', 'mid', 'mid-t1-blue']]);
    b.waves.mid = -1;
    b.scuttlesSeen.blue['scuttle-bot'] = 10_000;
    const bm = get(b, 'blue', 'mid').id;
    const moved: GameEvent = { type: 'moved', champion: bm, from: 'mid-t1-blue', to: 'scuttle-bot', acted: true };
    const take: GameEvent = { type: 'objectiveTaken', objective: 'scuttle', side: 'red', position: 'scuttle-bot', champions: [] };
    const fledBack = structuredClone(b);
    expect(ids(explainRound(b, fledBack, [moved, take], d, 'blue'))).toContain('left-lane-without-priority');
    const stayed = structuredClone(b);
    get(stayed, 'blue', 'mid').position = 'scuttle-bot';
    expect(ids(explainRound(b, stayed, [moved, take], d, 'blue'))).toContain('wave-sacrifice-for-objective');
  });
});
