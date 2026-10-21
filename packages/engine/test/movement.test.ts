import { describe, expect, test } from 'bun:test';
import { loadGameData, mirrorId } from '@lml/data';
import { canAct, defaultOrders, newGame, reachable, reachableFrom, roundWindow, route, spawnPoints, stepBudget, validateOrders } from '@lml/engine';
import type { ChampionState, GameState, Order } from '@lml/engine/contracts';

const d = loadGameData();
const fresh = (): GameState => newGame(d, 7);
const get = (s: GameState, side: string, role: string): ChampionState =>
  s.champions.find((c) => c.side === side && c.role === role)!;

/** Valid stay-put orders for blue, then overrides by champion id. */
function orders(s: GameState, over: Order[] = []): Order[] {
  const base = defaultOrders(s, d, 'blue');
  return base.map((o) => over.find((x) => x.champion === o.champion) ?? o);
}

describe('step budget', () => {
  /** First round of the 1-based `phase`. */
  const firstRoundOf = (phase: number): number => {
    for (let r = 1; ; r++) if (roundWindow(d.rules, r).phase === phase - 1) return r;
  };
  test('2 steps in round 1, 3 in phase 3 and 4 in phase 5', () => {
    expect(stepBudget(d.rules, 1)).toBe(2);
    expect(stepBudget(d.rules, firstRoundOf(3))).toBe(3);
    expect(stepBudget(d.rules, firstRoundOf(5))).toBe(4);
  });
  test('an action needs a step left: staying acts, arriving on the last step does not', () => {
    expect(canAct(0, 2)).toBe(true);
    expect(canAct(1, 2)).toBe(true);
    expect(canAct(2, 2)).toBe(false);
  });
});

describe('reach with budget 2', () => {
  const reach = (from: string, side: 'blue' | 'red' = 'blue'): Record<string, number> => reachableFrom(d, from, 2, side);
  const acting = (from: string): string[] =>
    Object.entries(reach(from)).filter(([, n]) => n > 0 && canAct(n, 2)).map(([p]) => p).sort();

  test('top-t1-blue acts on its lane neighbours, the top river and its outer camps; top-t1-red is arrival-only', () => {
    expect(acting('top-t1-blue')).toEqual(
      ['baron-pit', 'bluebuff-blue', 'gromp-blue', 'mid-t1-blue', 'scuttle-top', 'top-lane', 'top-t2-blue'],
    );
    expect(reach('top-t1-blue')['top-t1-red']).toBe(2);
  });
  test('krugs-blue acts on scuttle-bot; dragon-pit is arrival-only', () => {
    expect(reach('krugs-blue')['scuttle-bot']).toBe(1);
    expect(reach('krugs-blue')['dragon-pit']).toBe(2);
  });
  test('mid-lane acts on both pits and both scuttles', () => {
    for (const p of ['baron-pit', 'dragon-pit', 'scuttle-top', 'scuttle-bot']) expect(reach('mid-lane')[p]).toBe(1);
  });
  test('no position reaches the enemy base, whatever the budget', () => {
    for (const p of Object.keys(d.graph.positions).filter((x) => !x.startsWith('base-'))) {
      expect(reachableFrom(d, p, 2, 'blue')['base-red']).toBeUndefined();
      expect(reachableFrom(d, p, 4, 'blue')['base-red']).toBeUndefined();
      expect(reachableFrom(d, p, 4, 'red')['base-blue']).toBeUndefined();
    }
  });
  test('red reaches the mirror of what blue reaches', () => {
    for (const p of Object.keys(d.graph.positions)) {
      for (const budget of [2, 3, 4]) {
        const blue = reachableFrom(d, p, budget, 'blue');
        const red = reachableFrom(d, mirrorId(p), budget, 'red');
        expect(Object.fromEntries(Object.entries(blue).map(([k, v]) => [mirrorId(k), v]))).toEqual(red);
      }
    }
  });
  test('reachable uses the round budget for every role', () => {
    const s = fresh();
    for (const c of s.champions.filter((x) => x.side === 'blue')) {
      expect(reachable(s, d, c.id)).toEqual(reachableFrom(d, c.position, 2, 'blue'));
    }
  });
});

describe('route', () => {
  test('a shortest path, both ends included, preferring a lane position over a camp or the river', () => {
    // krugs-blue to dragon-pit is 2 steps through bot-t1-blue, mid-t1-blue, redbuff-blue or scuttle-bot.
    expect(route(d, 'krugs-blue', 'dragon-pit', 'blue')).toEqual(['krugs-blue', 'bot-t1-blue', 'dragon-pit']);
    expect(route(d, 'krugs-red', 'baron-pit', 'red')).toEqual(['krugs-red', 'top-t1-red', 'baron-pit']);
    expect(route(d, 'wolves-blue', 'wolves-blue', 'blue')).toEqual(['wolves-blue']);
  });
  test('red walks the mirror of the blue route', () => {
    const ids = Object.keys(d.graph.positions).filter((p) => !p.startsWith('base-'));
    for (const from of ids) {
      for (const to of ids) {
        expect(route(d, mirrorId(from), mirrorId(to), 'red')).toEqual(route(d, from, to, 'blue').map(mirrorId));
      }
    }
  });
  test('changing lane ends the move: the route only changes lane on its last step', () => {
    expect(route(d, 'top-t1-blue', 'bot-t1-blue', 'blue')).toEqual(['top-t1-blue', 'baron-pit', 'mid-t1-blue', 'bot-t1-blue']);
  });
  test('never through the enemy base', () => {
    expect(() => route(d, 'top-t3-red', 'base-red', 'blue')).toThrow(/no route/);
  });
});

describe('validateOrders', () => {
  test('a move beyond the budget is rejected', () => {
    const s = fresh();
    const j = get(s, 'blue', 'jungle');
    j.position = 'raptors-blue';
    const mv = (to: string): Order => ({ kind: 'move', champion: j.id, to });
    expect(() => validateOrders(s, d, 'blue', orders(s, [mv('krugs-blue')]))).not.toThrow();
    expect(() => validateOrders(s, d, 'blue', orders(s, [mv('top-t2-blue')]))).toThrow(/reach/);
  });
  test('a recall step leaves a step for the recall: 2 steps with budget 2 is rejected', () => {
    const s = fresh();
    const top = get(s, 'blue', 'top');
    top.position = 'top-lane';
    const rc = (to: string): Order => ({ kind: 'recall', champion: top.id, to });
    expect(() => validateOrders(s, d, 'blue', orders(s, [rc('top-t1-blue')]))).not.toThrow();
    expect(() => validateOrders(s, d, 'blue', orders(s, [rc('top-t2-blue')]))).toThrow(/recall step/);
  });
  test('recall ward and unward share the move limits', () => {
    const s = fresh();
    const blue = s.champions.filter((c) => c.side === 'blue');
    const rw = (c: ChampionState, ward: 'from' | 'to'): Order => ({ kind: 'recall', champion: c.id, to: c.position, ward });
    expect(() => validateOrders(s, d, 'blue', orders(s, blue.slice(0, 3).map((c) => rw(c, 'to'))))).not.toThrow();
    expect(() => validateOrders(s, d, 'blue', orders(s, blue.slice(0, 4).map((c) => rw(c, 'to'))))).toThrow(/wards/);
    const ru = (c: ChampionState): Order => ({ kind: 'recall', champion: c.id, to: c.position, unward: 'to' });
    const jg = get(s, 'blue', 'jungle');
    expect(() => validateOrders(s, d, 'blue', orders(s, [ru(jg)]))).not.toThrow();
    expect(() => validateOrders(s, d, 'blue', orders(s, [ru(jg), ru(get(s, 'blue', 'support'))]))).toThrow(/unward/);
    expect(() => validateOrders(s, d, 'blue', orders(s, [ru(get(s, 'blue', 'top'))]))).toThrow(/unward/);
    expect(() => validateOrders(s, d, 'blue', orders(s, [{ kind: 'recall', champion: jg.id, ward: 'to' }]))).toThrow(/step/);
  });
  test('one order each', () => {
    const s = fresh();
    const o = orders(s);
    expect(() => validateOrders(s, d, 'blue', o)).not.toThrow();
    expect(() => validateOrders(s, d, 'blue', o.slice(1))).toThrow(/missing/);
    expect(() => validateOrders(s, d, 'blue', [...o, o[0]!])).toThrow(/duplicate/);
  });
  test('ward and unward limits', () => {
    const s = fresh();
    const w = (c: ChampionState): Order => ({ kind: 'move', champion: c.id, to: c.position, ward: 'to' });
    const blue = s.champions.filter((c) => c.side === 'blue');
    expect(() => validateOrders(s, d, 'blue', orders(s, blue.slice(0, 4).map(w)))).toThrow(/wards/);
    const u = (c: ChampionState): Order => ({ kind: 'move', champion: c.id, to: c.position, unward: 'to' });
    const jg = get(s, 'blue', 'jungle');
    const sup = get(s, 'blue', 'support');
    expect(() => validateOrders(s, d, 'blue', orders(s, [u(jg)]))).not.toThrow();
    expect(() => validateOrders(s, d, 'blue', orders(s, [u(jg), u(sup)]))).toThrow(/unward/);
    expect(() => validateOrders(s, d, 'blue', orders(s, [u(get(s, 'blue', 'top'))]))).toThrow(/unward/);
  });
  test('position ward only round 1 for jungler', () => {
    const s = fresh();
    const j = get(s, 'blue', 'jungle');
    const o: Order = { kind: 'move', champion: j.id, to: j.position, ward: { position: 'raptors-red' } };
    expect(() => validateOrders(s, d, 'blue', orders(s, [o]))).not.toThrow();
    s.round = 2;
    expect(() => validateOrders(s, d, 'blue', orders(s, [o]))).toThrow(/ward/);
  });
  test('respawning and dead', () => {
    const s = fresh();
    const top = get(s, 'blue', 'top');
    top.status = 'respawning';
    expect(() =>
      validateOrders(s, d, 'blue', orders(s, [{ kind: 'move', champion: top.id, to: top.position }])),
    ).toThrow(/spawn/);
    expect(() => validateOrders(s, d, 'blue', defaultOrders(s, d, 'blue'))).not.toThrow();
    top.status = 'dead';
    expect(() =>
      validateOrders(s, d, 'blue', [...defaultOrders(s, d, 'blue'), { kind: 'spawn', champion: top.id, to: 'top-t1-blue' }]),
    ).toThrow(/dead/);
    expect(() => validateOrders(s, d, 'blue', defaultOrders(s, d, 'blue'))).not.toThrow();
  });
  test('herald', () => {
    const s = fresh();
    const top = get(s, 'blue', 'top');
    top.position = 'top-lane';
    const h = (to: string): Order => ({ kind: 'move', champion: top.id, to, launchHerald: true });
    expect(() => validateOrders(s, d, 'blue', orders(s, [h('top-t1-red')]))).toThrow(/herald/);
    top.hasHerald = true;
    expect(() => validateOrders(s, d, 'blue', orders(s, [h('top-t1-red')]))).not.toThrow();
    expect(() => validateOrders(s, d, 'blue', orders(s, [h('top-t1-blue')]))).toThrow(/herald/);
  });
});

describe('spawnPoints', () => {
  test('laner and jungler', () => {
    const s = fresh();
    const top = get(s, 'blue', 'top');
    top.status = 'respawning';
    expect(spawnPoints(s, d, top.id)).toEqual(['top-t1-blue', 'mid-t1-blue', 'bot-t1-blue']);
    s.towers['top-t1-blue'] = 0;
    expect(spawnPoints(s, d, top.id)[0]).toBe('top-t2-blue');
    expect(defaultOrders(s, d, 'blue').find((o) => o.champion === top.id)).toEqual({
      kind: 'spawn', champion: top.id, to: 'top-t2-blue',
    });
    expect(spawnPoints(s, d, get(s, 'blue', 'jungle').id)).toHaveLength(6);
  });
});

describe('defaultOrders and spawn validation', () => {
  test('respawning laner and jungler spawn at the first spawn point', () => {
    const s = fresh();
    const top = get(s, 'blue', 'top');
    const jg = get(s, 'blue', 'jungle');
    top.status = 'respawning';
    jg.status = 'respawning';
    const o = defaultOrders(s, d, 'blue');
    for (const c of [top, jg]) {
      expect(o.find((x) => x.champion === c.id)).toEqual({
        kind: 'spawn', champion: c.id, to: spawnPoints(s, d, c.id)[0]!,
      });
    }
    expect(() => validateOrders(s, d, 'blue', o)).not.toThrow();
  });
  test('spawn order rejected for alive champion or bad point', () => {
    const s = fresh();
    const top = get(s, 'blue', 'top');
    const sp: Order = { kind: 'spawn', champion: top.id, to: 'top-t1-blue' };
    expect(() => validateOrders(s, d, 'blue', orders(s, [sp]))).toThrow(/spawn/);
    top.status = 'respawning';
    expect(() =>
      validateOrders(s, d, 'blue', orders(s, [{ ...sp, to: 'top-t2-blue' }])),
    ).toThrow(/spawn/);
  });
});

describe('laners follow their wave', () => {
  const target = (s: GameState, side: string, role: string): string => {
    const c = get(s, side, role);
    const o = defaultOrders(s, d, side as 'blue' | 'red').find((x) => x.champion === c.id)!;
    expect(o.kind).toBe('move');
    return (o as Extract<Order, { kind: 'move' }>).to;
  };
  /** Blue and red mids on the lane middle, the wave at `wave`. */
  const atMid = (wave: -1 | 0 | 1): GameState => {
    const s = fresh();
    get(s, 'blue', 'mid').position = 'mid-lane';
    get(s, 'red', 'mid').position = 'mid-lane';
    s.waves.mid = wave;
    return s;
  };

  test.each([
    [-1, 'mid-t1-blue'],
    [0, 'mid-lane'],
    [1, 'mid-t1-red'],
  ] as const)('wave %d: blue and red laners go to %s', (wave, spot) => {
    const s = atMid(wave);
    expect(target(s, 'blue', 'mid')).toBe(spot);
    expect(target(s, 'red', 'mid')).toBe(spot);
    expect(() => validateOrders(s, d, 'blue', defaultOrders(s, d, 'blue'))).not.toThrow();
    expect(() => validateOrders(s, d, 'red', defaultOrders(s, d, 'red'))).not.toThrow();
  });

  test('a wave out of reach is approached one step; a destroyed front tower moves the spot back', () => {
    const s = fresh();
    get(s, 'blue', 'top').position = 'top-t2-blue';
    get(s, 'red', 'top').position = 'top-t2-red';
    s.waves.top = 1;
    expect(target(s, 'blue', 'top')).toBe('top-t1-blue');
    expect(target(s, 'red', 'top')).toBe('top-t1-red');
    s.towers['top-t1-red'] = 0;
    s.waves.top = 1;
    expect(target(s, 'red', 'top')).toBe('top-t2-red');
  });

  test('a laner away from its lane and a jungler stay put', () => {
    const s = fresh();
    get(s, 'blue', 'mid').position = 'scuttle-top';
    s.waves.mid = 1;
    expect(target(s, 'blue', 'mid')).toBe('scuttle-top');
    expect(target(s, 'blue', 'jungle')).toBe(get(s, 'blue', 'jungle').position);
  });
});

describe('changing lane ends the move', () => {
  test('jungler reaches mid-t1 from top-t1 but not bot-t1', () => {
    const s = fresh();
    const j = get(s, 'blue', 'jungle');
    j.position = 'top-t1-blue';
    const r = reachable(s, d, j.id);
    expect(r['mid-t1-blue']).toBe(1);
    expect(r['bot-t1-blue']).toBeUndefined();
    expect(() => validateOrders(s, d, 'blue', orders(s, [{ kind: 'move', champion: j.id, to: 'bot-t1-blue' }]))).toThrow(/reach/);
  });
  test('the river is no lane: from scuttle-top the move goes on past mid-t1-blue', () => {
    expect(reachableFrom(d, 'scuttle-top', 2, 'blue')['bot-t1-blue']).toBe(2);
  });
});

describe('default respawn', () => {
  for (const [role, lane] of [['adc', 'bot'], ['support', 'bot'], ['mid', 'mid'], ['top', 'top']] as const) {
    test(`${role} respawns on its ${lane} front tower`, () => {
      const s = newGame(d, 3);
      const c = s.champions.find((x) => x.side === 'blue' && x.role === role)!;
      c.status = 'respawning';
      const to = () => defaultOrders(s, d, 'blue').find((o) => o.champion === c.id)!.to;
      expect(to()).toBe(`${lane}-t1-blue`);
      s.towers[`${lane}-t1-blue`] = 0;
      expect(to()).toBe(`${lane}-t2-blue`);
    });
  }
});
