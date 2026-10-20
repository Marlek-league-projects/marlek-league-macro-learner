import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { defaultOrders, newGame, reachable, spawnPoints, validateOrders } from '@lml/engine';
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

describe('reachable', () => {
  test('laner reaches adjacent tower only', () => {
    const s = fresh();
    const mid = get(s, 'blue', 'mid');
    mid.position = 'mid-t1-blue';
    const r = reachable(s, d, mid.id);
    expect(r['mid-t1-blue']).toBe(0);
    expect(r['top-t1-blue']).toBe(1);
    expect(r['top-lane']).toBeUndefined();
    expect(r['base-red']).toBeUndefined();
  });
  test('jungler reaches two steps', () => {
    const s = fresh();
    const j = get(s, 'blue', 'jungle');
    j.position = 'raptors-blue';
    const r = reachable(s, d, j.id);
    expect(r['krugs-blue']).toBeDefined();
    expect(r['bluebuff-red']).toBeDefined();
  });
});

describe('validateOrders', () => {
  test('via', () => {
    const s = fresh();
    const j = get(s, 'blue', 'jungle');
    j.position = 'raptors-blue';
    const mv = (via: string): Order => ({ kind: 'move', champion: j.id, to: 'krugs-blue', via });
    expect(() => validateOrders(s, d, 'blue', orders(s, [mv('redbuff-blue')]))).not.toThrow();
    expect(() => validateOrders(s, d, 'blue', orders(s, [mv('mid-lane')]))).toThrow(/via/);
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

describe('jungler objective reach', () => {
  const OBJECTIVES = ['scuttle-top', 'scuttle-bot', 'baron-pit', 'dragon-pit'];
  const camps = Object.values(d.graph.positions).filter((p) => p.kind === 'camp');
  test('a jungler on any camp reaches both scuttles and both pits', () => {
    expect(camps).toHaveLength(12);
    for (const camp of camps) {
      const s = fresh();
      const j = get(s, 'blue', 'jungle');
      j.position = camp.id;
      const r = reachable(s, d, j.id);
      for (const o of OBJECTIVES) expect(r[o]).toBeLessThanOrEqual(2);
      validateOrders(s, d, 'blue', orders(s, [{ kind: 'move', champion: j.id, to: 'dragon-pit' }]));
    }
  });
  test('a laner standing on a camp gets no bonus', () => {
    const s = fresh();
    const top = get(s, 'blue', 'top');
    top.position = 'gromp-blue';
    const r = reachable(s, d, top.id);
    for (const o of OBJECTIVES) expect(r[o]).toBeUndefined();
  });
  test('the bonus needs a camp: a jungler in lane gets none', () => {
    const s = fresh();
    const j = get(s, 'blue', 'jungle');
    j.position = 'top-t1-blue';
    expect(reachable(s, d, j.id)['dragon-pit']).toBeUndefined();
  });
  test('mid T1 reaches neither pit in 1 move', () => {
    const s = fresh();
    const mid = get(s, 'blue', 'mid');
    mid.position = 'mid-t1-blue';
    const r = reachable(s, d, mid.id);
    expect(r['baron-pit']).toBeUndefined();
    expect(r['dragon-pit']).toBeUndefined();
  });
  test('the flag turns the bonus off', () => {
    const s = fresh();
    const j = get(s, 'blue', 'jungle');
    j.position = 'gromp-blue';
    const off = { ...d, rules: { ...d.rules, moves: { ...d.rules.moves, junglerObjectiveReach: false } } };
    expect(reachable(s, off, j.id)['dragon-pit']).toBeUndefined();
  });
});
