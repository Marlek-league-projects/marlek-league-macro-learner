import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { defaultOrders, detectContacts, newGame, resolveChoice } from '@lml/engine';
import type { ChampionState, GameState, Order, Orders } from '@lml/engine/contracts';

const d = loadGameData();
const get = (s: GameState, side: string, role: string): ChampionState =>
  s.champions.find((c) => c.side === side && c.role === role)!;

function setup(place: Array<[string, string, string]>): GameState {
  const s = newGame(d, 7);
  for (const [side, role, pos] of place) get(s, side, role).position = pos;
  return s;
}
const stay = (s: GameState, over: Order[] = []): Orders => {
  const f = (side: 'blue' | 'red'): Order[] =>
    defaultOrders(s, d, side).map((o) => over.find((x) => x.champion === o.champion) ?? o);
  return { blue: f('blue'), red: f('red') };
};

describe('detectContacts', () => {
  test('even numbers in lane is a trade', () => {
    const s = setup([['blue', 'top', 'top-lane'], ['red', 'top', 'top-lane']]);
    const cs = detectContacts(s, d, stay(s)).filter((c) => c.position === 'top-lane');
    expect(cs).toHaveLength(1);
    expect(cs[0]!.kind).toBe('trade');
    expect(cs[0]!.defaults).toEqual({ blue: 'trade', red: 'trade' });
    expect(cs[0]!.options.blue).toEqual(['trade', 'fight', 'flee']);
  });

  test('outnumbering arrival is a gank', () => {
    const s = setup([
      ['blue', 'top', 'top-t1-blue'], ['red', 'top', 'top-t1-blue'], ['red', 'jungle', 'top-lane'],
    ]);
    const rj = get(s, 'red', 'jungle');
    const o = stay(s, [{ kind: 'move', champion: rj.id, to: 'top-t1-blue' }]);
    const c = detectContacts(s, d, o).find((x) => x.position === 'top-t1-blue')!;
    expect(c.kind).toBe('gank');
    expect(c.defaults).toEqual({ blue: 'flee', red: 'fight' });
    expect(c.options.blue).toEqual(['fight', 'flee']);
    expect(c.red).toHaveLength(2);
  });

  test('entering an enemy camp is an invade', () => {
    const s = setup([['blue', 'jungle', 'raptors-red'], ['red', 'jungle', 'raptors-red']]);
    const c = detectContacts(s, d, stay(s)).find((x) => x.position === 'raptors-red')!;
    expect(c.kind).toBe('invade');
    expect(c.invader).toBe('blue');
    expect(c.options.blue).toEqual(['fight']);
    expect(c.options.red).toEqual(['fight', 'flee']);
    expect(c.defaults.red).toBe('fight');
  });

  test('objective and skirmish', () => {
    const s = setup([['blue', 'jungle', 'baron-pit'], ['red', 'jungle', 'baron-pit']]);
    expect(detectContacts(s, d, stay(s)).find((x) => x.position === 'baron-pit')!.kind).toBe('objective');
  });

  test('crossing on an edge is no contact', () => {
    const s = setup([['blue', 'mid', 'mid-t1-blue'], ['red', 'mid', 'mid-lane']]);
    const b = get(s, 'blue', 'mid');
    const r = get(s, 'red', 'mid');
    const o = stay(s, [
      { kind: 'move', champion: b.id, to: 'mid-lane' },
      { kind: 'move', champion: r.id, to: 'mid-t1-blue' },
    ]);
    expect(detectContacts(s, d, o).filter((c) => c.blue.includes(b.id))).toHaveLength(0);
  });

  test('dead champions and recallers stay out; recall stays put', () => {
    const s = setup([['blue', 'top', 'top-lane'], ['red', 'top', 'top-lane']]);
    get(s, 'red', 'top').status = 'dead';
    expect(detectContacts(s, d, stay(s)).filter((c) => c.position === 'top-lane')).toHaveLength(0);
    const s2 = setup([['blue', 'top', 'top-lane'], ['red', 'top', 'top-lane']]);
    const o = stay(s2, [{ kind: 'recall', champion: get(s2, 'red', 'top').id }]);
    expect(detectContacts(s2, d, o).filter((c) => c.position === 'top-lane')).toHaveLength(1);
  });
});

describe('resolveChoice', () => {
  const s = setup([['blue', 'jungle', 'raptors-red'], ['red', 'jungle', 'raptors-red']]);
  const c = detectContacts(s, d, stay(s)).find((x) => x.position === 'raptors-red')!;
  test('rejects disallowed option', () => {
    expect(() => resolveChoice(c, { [c.id]: { blue: 'flee' } })).toThrow(/not allowed/);
  });
  test('fills defaults', () => {
    expect(resolveChoice(c, { [c.id]: { red: 'flee' } })).toEqual({ blue: 'fight', red: 'flee' });
    expect(resolveChoice(c, {})).toEqual({ blue: 'fight', red: 'fight' });
  });
});
