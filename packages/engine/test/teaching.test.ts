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
    const { state, events } = resolveRound(s, d, o, { 'scuttle-bot': { blue: 'fight' } });
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
});
