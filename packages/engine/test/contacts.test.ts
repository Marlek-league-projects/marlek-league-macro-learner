import { describe, expect, test } from 'bun:test';
import { loadGameData, mirrorId } from '@lml/data';
import { defaultOrders, detectContacts, fightScore, newGame, resolveChoice, resolveRound } from '@lml/engine';
import type { ChampionState, GameState, Order, Orders } from '@lml/engine/contracts';

const d = loadGameData();
const get = (s: GameState, side: string, role: string): ChampionState =>
  s.champions.find((c) => c.side === side && c.role === role)!;

function setup(place: Array<[string, string, string]>): GameState {
  const s = newGame(d, 7);
  for (const [side, role, pos] of place) get(s, side, role).position = pos;
  return s;
}
/** The bot Scuttle is up, and both sides saw it. */
const scuttleBotUp = (s: GameState): void => {
  s.scuttles['scuttle-bot'] = 0;
  s.scuttlesSeen.blue['scuttle-bot'] = 0;
  s.scuttlesSeen.red['scuttle-bot'] = 0;
};
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
    expect(cs[0]!.auto).toBe(true);
    expect(cs[0]!.defaults).toEqual({ blue: 'farm', red: 'farm' });
    expect(cs[0]!.options).toEqual({ blue: ['farm'], red: ['farm'] });
  });

  test('outnumbering arrival is a gank', () => {
    const s = setup([
      ['blue', 'top', 'top-t1-blue'], ['red', 'top', 'top-t1-blue'], ['red', 'jungle', 'gromp-blue'],
    ]);
    s.waves.top = -1; // both tops follow the wave onto the blue T1
    const rj = get(s, 'red', 'jungle');
    const o = stay(s, [{ kind: 'move', champion: rj.id, to: 'top-t1-blue' }]);
    const c = detectContacts(s, d, o).find((x) => x.position === 'top-t1-blue')!;
    expect(c.kind).toBe('gank');
    expect(c.id).toBe('lane-top');
    expect(c.defaults).toEqual({ blue: 'flee', red: 'fight' });
    // Blue stands alone on its own standing T1: it may also stay and farm.
    expect(c.options.blue).toEqual(['fight', 'flee', 'farm']);
    expect(c.options.red).toEqual(['fight', 'flee']);
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

  test('crossing on an edge between two zones is no contact', () => {
    const s = setup([['blue', 'jungle', 'gromp-blue'], ['red', 'jungle', 'bluebuff-blue']]);
    const b = get(s, 'blue', 'jungle');
    const r = get(s, 'red', 'jungle');
    const o = stay(s, [
      { kind: 'move', champion: b.id, to: 'bluebuff-blue' },
      { kind: 'move', champion: r.id, to: 'gromp-blue' },
    ]);
    expect(detectContacts(s, d, o).filter((c) => c.blue.includes(b.id))).toHaveLength(0);
  });

  test('dead champions and recallers stay out; recall stays put', () => {
    const s = setup([['blue', 'top', 'top-lane'], ['red', 'top', 'top-lane']]);
    get(s, 'red', 'top').status = 'dead';
    expect(detectContacts(s, d, stay(s)).filter((c) => c.id === 'lane-top')).toHaveLength(0);
    const s2 = setup([['blue', 'top', 'top-lane'], ['red', 'top', 'top-lane']]);
    const o = stay(s2, [{ kind: 'recall', champion: get(s2, 'red', 'top').id }]);
    expect(detectContacts(s2, d, o).filter((c) => c.position === 'top-lane')).toHaveLength(1);
  });
});

describe('fight position', () => {
  const at = (blue: string, red: string, role: 'mid' | 'jungle'): string => {
    const s = setup([['blue', role, blue], ['red', role, red]]);
    const [b, r] = [get(s, 'blue', role).id, get(s, 'red', role).id];
    const o = stay(s, [{ kind: 'move', champion: b, to: blue }, { kind: 'move', champion: r, to: red }]);
    return detectContacts(s, d, o).find((c) => c.blue.includes(b))!.position;
  };

  test('opposite T1s resolve at the lane middle, not at the blue tower', () => {
    expect(at('mid-t1-blue', 'mid-t1-red', 'mid')).toBe('mid-lane');
    expect(at('mid-t1-red', 'mid-t1-blue', 'mid')).toBe('mid-lane');
  });

  test('an even tie is side-neutral: the mirrored contact resolves at the mirrored position', () => {
    const lane = d.graph.lanePositions('mid');
    for (const b of lane) {
      for (const r of lane) {
        expect(at(mirrorId(r), mirrorId(b), 'mid')).toBe(mirrorId(at(b, r, 'mid')));
      }
    }
    for (const [b, r] of [['scuttle-top', 'baron-pit'], ['baron-pit', 'scuttle-top']] as const) {
      expect(at(mirrorId(r), mirrorId(b), 'jungle')).toBe(mirrorId(at(b, r, 'jungle')));
    }
  });
});

describe('zone contacts', () => {
  test('playtest: an enemy laner alone on my T1 against my laner and my jungler in the lane is a prompted gank on my tower', () => {
    const s = setup([['red', 'top', 'top-t1-blue'], ['blue', 'top', 'top-lane'], ['blue', 'jungle', 'scuttle-top']]);
    const [bt, bj, rt] = [get(s, 'blue', 'top').id, get(s, 'blue', 'jungle').id, get(s, 'red', 'top').id];
    const o = stay(s, [
      { kind: 'move', champion: rt, to: 'top-t1-blue' },
      { kind: 'move', champion: bt, to: 'top-lane' },
      { kind: 'move', champion: bj, to: 'top-lane' },
    ]);
    const c = detectContacts(s, d, o).find((x) => x.id === 'lane-top')!;
    expect(c).toMatchObject({ kind: 'gank', auto: false, position: 'top-t1-blue', positions: ['top-lane', 'top-t1-blue'] });
    expect(c.defaults).toEqual({ blue: 'fight', red: 'flee' });
    const { state, events } = resolveRound(s, d, o, { 'lane-top': { red: 'fight' } });
    const fight = events.find((e) => e.type === 'fight')!;
    expect(fight).toMatchObject({ position: 'top-t1-blue', winner: 'blue' });
    // The blue tower counts for blue.
    const withTower = fightScore(s, d, 'blue', [bj, bt].sort(), [rt], 0, 'blue');
    expect(fight.type === 'fight' && fight.scores.blue).toBeCloseTo(withTower, 9);
    expect(withTower).toBeGreaterThan(fightScore(s, d, 'blue', [bj, bt].sort(), [rt], 0, null));
    // The blue champions were moved onto the fight position.
    for (const id of [bt, bj]) expect(state.champions.find((x) => x.id === id)!.position).toBe('top-t1-blue');
    expect(events).toContainEqual({ type: 'moved', champion: bt, from: 'top-lane', to: 'top-t1-blue', acted: true });
  });

  test('standard 1v1 and 2v2 lanes stay automatic, on any positions of the lane', () => {
    const s = setup([
      ['blue', 'top', 'top-t1-blue'], ['red', 'top', 'top-lane'],
      ['blue', 'adc', 'bot-lane'], ['blue', 'support', 'bot-t1-blue'], ['red', 'adc', 'bot-lane'], ['red', 'support', 'bot-lane'],
    ]);
    const pin = (role: string, side: string, to: string): Order => ({ kind: 'move', champion: get(s, side, role).id, to });
    const o = stay(s, [
      pin('top', 'blue', 'top-t1-blue'), pin('top', 'red', 'top-lane'),
      pin('adc', 'blue', 'bot-lane'), pin('support', 'blue', 'bot-t1-blue'), pin('adc', 'red', 'bot-lane'), pin('support', 'red', 'bot-lane'),
    ]);
    const cs = detectContacts(s, d, o);
    const top = cs.find((c) => c.id === 'lane-top')!;
    expect(top).toMatchObject({ kind: 'trade', auto: true, position: 'top-lane', positions: ['top-lane', 'top-t1-blue'] });
    expect(cs.find((c) => c.id === 'lane-bot')).toMatchObject({ kind: 'trade', auto: true, position: 'bot-lane' });
  });

  test('a jungler on each side in a lane is a prompted skirmish', () => {
    const s = setup([['blue', 'jungle', 'mid-lane'], ['red', 'jungle', 'mid-lane'], ['blue', 'mid', 'mid-lane'], ['red', 'mid', 'mid-lane']]);
    const pin = (side: string, role: string): Order => ({ kind: 'move', champion: get(s, side, role).id, to: 'mid-lane' });
    const c = detectContacts(s, d, stay(s, [pin('blue', 'jungle'), pin('red', 'jungle'), pin('blue', 'mid'), pin('red', 'mid')]))
      .find((x) => x.id === 'lane-mid')!;
    expect(c).toMatchObject({ kind: 'skirmish', auto: false, defaults: { blue: 'fight', red: 'fight' } });
  });

  test('blue on scuttle-bot and red on dragon-pit is one river-bot contact; acting sides may keep taking the objective', () => {
    const s = setup([['blue', 'jungle', 'krugs-blue'], ['red', 'jungle', 'bluebuff-red']]);
    scuttleBotUp(s);
    const bj = get(s, 'blue', 'jungle').id;
    const rj = get(s, 'red', 'jungle').id;
    const o = stay(s, [{ kind: 'move', champion: bj, to: 'scuttle-bot' }, { kind: 'move', champion: rj, to: 'dragon-pit' }]);
    const cs = detectContacts(s, d, o).filter((c) => c.id.startsWith('river-'));
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ id: 'river-bot', kind: 'objective', positions: ['dragon-pit', 'scuttle-bot'], blue: [bj], red: [rj] });
    expect(cs[0]!.options).toEqual({ blue: ['fight', 'flee', 'objective'], red: ['fight', 'flee', 'objective'] });
  });

  test('an arrival-only champion on the pit cannot choose objective, and still fights', () => {
    const s = setup([['blue', 'jungle', 'krugs-blue'], ['red', 'jungle', 'scuttle-bot']]);
    scuttleBotUp(s);
    const bj = get(s, 'blue', 'jungle').id;
    const o = stay(s, [{ kind: 'move', champion: bj, to: 'dragon-pit' }]);
    const c = detectContacts(s, d, o).find((x) => x.id === 'river-bot')!;
    expect(c.options.blue).toEqual(['fight', 'flee']);
    expect(c.options.red).toEqual(['fight', 'flee', 'objective']);
    expect(() => resolveChoice(c, { 'river-bot': { blue: 'objective' } })).toThrow(/not allowed/);
    const { events } = resolveRound(s, d, o, { 'river-bot': { blue: 'fight', red: 'fight' } });
    expect(events.some((e) => e.type === 'fight' && e.blue.includes(bj))).toBe(true);
  });

  test('a base is never a contact', () => {
    const s = setup([]);
    for (const c of s.champions) c.position = `base-${c.side === 'blue' ? 'red' : 'blue'}`;
    get(s, 'red', 'top').position = 'base-red';
    const o: Orders = { blue: [], red: [] };
    expect(detectContacts(s, d, o)).toHaveLength(0);
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

test('a recalling champion on the pit cannot choose objective', () => {
  const s = setup([['blue', 'jungle', 'dragon-pit'], ['red', 'jungle', 'bluebuff-red']]);
  scuttleBotUp(s);
  const bj = get(s, 'blue', 'jungle').id;
  const rj = get(s, 'red', 'jungle').id;
  const o = stay(s, [{ kind: 'recall', champion: bj }, { kind: 'move', champion: rj, to: 'dragon-pit' }]);
  const c = detectContacts(s, d, o).find((x) => x.id === 'river-bot')!;
  expect(c.options.blue).toEqual(['fight', 'flee']);
  expect(c.options.red).toEqual(['fight', 'flee', 'objective']);
});

describe('river objective option', () => {
  /** Scuttle respawn times: the real one, then as blue and red last saw it (0: up, Infinity: taken). */
  const river = (actual: number, blue = actual, red = actual) => {
    const s = setup([['blue', 'jungle', 'dragon-pit'], ['red', 'jungle', 'dragon-pit']]);
    s.round = 10;
    s.scuttles['scuttle-bot'] = actual;
    s.scuttlesSeen.blue['scuttle-bot'] = blue;
    s.scuttlesSeen.red['scuttle-bot'] = red;
    return detectContacts(s, d, stay(s)).find((x) => x.id === 'river-bot')!;
  };
  test('nothing to take: no objective option', () => {
    expect(river(Infinity).options.blue).toEqual(['fight', 'flee']);
  });
  test('Scuttle up: objective option', () => {
    expect(river(0).options.blue).toContain('objective');
  });
  test('the option follows what each side saw of the Scuttle, never the hidden truth', () => {
    // Red took it unseen by blue: blue still believes it is up; red knows it is gone.
    expect(river(Infinity, 0, Infinity).options).toEqual({ blue: ['fight', 'flee', 'objective'], red: ['fight', 'flee'] });
    // Up again, but only blue saw it respawn.
    expect(river(0, 0, Infinity).options).toEqual({ blue: ['fight', 'flee', 'objective'], red: ['fight', 'flee'] });
  });
});
