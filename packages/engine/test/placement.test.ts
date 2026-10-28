import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import type { Side } from '@lml/data/contracts';
import {
  aiAnswers, aiOrders, aiPlacements, createEngine, createRng, defaultOrders, detectContacts, newGame, placeChampions,
  placementPositions, reachableFrom, resolveRound, stepBudget, viewFor,
} from '@lml/engine';
import type { GameState } from '@lml/engine/contracts';

const d = loadGameData();
const of = (s: GameState, side: Side, role: string) => s.champions.find((c) => c.side === side && c.role === role)!;

describe('round 0 placement', () => {
  test('allowed positions: own towers, own camps, own base and the 3 lane middles; never the river or the enemy side', () => {
    for (const side of ['blue', 'red'] as const) {
      const enemy = side === 'blue' ? 'red' : 'blue';
      const ok = placementPositions(d, side);
      expect(ok).toHaveLength(9 + 6 + 1 + 3);
      for (const id of ['top-lane', 'mid-lane', 'bot-lane', `base-${side}`, `top-t1-${side}`, `mid-t3-${side}`, `gromp-${side}`, `bluebuff-${side}`]) {
        expect(ok).toContain(id);
      }
      for (const id of ['scuttle-top', 'scuttle-bot', 'baron-pit', 'dragon-pit', `base-${enemy}`, `top-t1-${enemy}`, `krugs-${enemy}`, `redbuff-${enemy}`]) {
        expect(ok).not.toContain(id);
      }
      expect(createEngine().placementPositions(d, side)).toEqual(ok);
    }
  });

  test('placeChampions moves only the positions; several champions may share one', () => {
    const g = newGame(d, 4);
    const top = of(g, 'blue', 'top');
    const mid = of(g, 'blue', 'mid');
    const s = placeChampions(g, d, 'blue', { [top.id]: 'top-lane', [mid.id]: 'top-lane' });
    expect(of(s, 'blue', 'top')).toEqual({ ...top, position: 'top-lane', previous: 'top-lane' });
    expect(of(s, 'blue', 'mid')).toMatchObject({ position: 'top-lane', previous: 'top-lane' });
    expect(top.position).toBe('top-t1-blue'); // the input state is untouched
    const strip = (x: GameState) => ({ ...x, champions: x.champions.filter((c) => c.id !== top.id && c.id !== mid.id) });
    expect(strip(s)).toEqual(strip(g));
  });

  test('forbidden placements throw: river, enemy side, unknown position, another side\'s champion, after round 1', () => {
    const g = newGame(d, 4);
    const top = of(g, 'blue', 'top').id;
    for (const bad of ['scuttle-top', 'dragon-pit', 'baron-pit', 'top-t1-red', 'gromp-red', 'base-red', 'nope']) {
      expect(() => placeChampions(g, d, 'blue', { [top]: bad })).toThrow();
    }
    expect(() => placeChampions(g, d, 'red', { [top]: 'top-t1-red' })).toThrow();
    expect(() => placeChampions({ ...g, round: 2 }, d, 'blue', { [top]: 'top-lane' })).toThrow();
  });

  test('default placements equal the new game (laners on their own T1, the jungler on its seeded buff)', () => {
    for (const seed of [1, 2, 3, 9]) {
      const g = newGame(d, seed);
      let s = g;
      for (const side of ['blue', 'red'] as const) {
        const ai = aiPlacements(viewFor(s, d, side), d);
        expect(ai[of(g, side, 'top').id]).toBe(`top-t1-${side}`);
        expect(ai[of(g, side, 'mid').id]).toBe(`mid-t1-${side}`);
        expect(ai[of(g, side, 'adc').id]).toBe(`bot-t1-${side}`);
        expect(ai[of(g, side, 'support').id]).toBe(`bot-t1-${side}`);
        expect(ai[of(g, side, 'jungle').id]).toBe(of(g, side, 'jungle').position);
        s = placeChampions(s, d, side, ai);
      }
      expect(s).toEqual(g);
    }
  });

  test('round 1 shows the enemy jungler where it was placed, not the laners', () => {
    const g = newGame(d, 9);
    const rj = of(g, 'red', 'jungle');
    const s = placeChampions(g, d, 'red', { [rj.id]: 'krugs-red' });
    const e = viewFor(s, d, 'blue').enemies.find((x) => x.id === rj.id)!;
    expect(e).toMatchObject({ visible: true, position: 'krugs-red' });
    expect(viewFor(s, d, 'blue').enemies.find((x) => x.id === of(s, 'red', 'top').id)).toMatchObject({ visible: false, position: null });
  });

  test('a jungler placed on a camp has cleared nothing: it clears its first camp in round 1', () => {
    const g = newGame(d, 5);
    const bj = of(g, 'blue', 'jungle');
    let s = placeChampions(g, d, 'blue', { [bj.id]: 'wolves-blue' });
    expect(s.camps['wolves-blue']).toBe(d.rules.camps.firstSpawnByCamp.wolves);
    expect(of(s, 'blue', 'jungle').gold).toBe(0);
    const orders = { blue: defaultOrders(s, d, 'blue'), red: defaultOrders(s, d, 'red') };
    s = resolveRound(s, d, orders, {}).state;
    expect(of(s, 'blue', 'jungle').gold).toBeGreaterThanOrEqual(d.rules.camps.smallGold);
    expect(s.camps['wolves-blue']).toBeGreaterThan(d.rules.camps.firstSpawnByCamp.wolves); // cleared, respawning
  });

  test('the AI jungler clears a camp in round 1', () => {
    for (const p of d.aiProfiles.filter((x) => x.rank === 'gold' || x.rank === 'challenger')) {
      for (const seed of [1, 2, 3]) {
        const s = newGame(d, seed);
        const rng = createRng(seed + 1);
        const view = viewFor(s, d, 'red');
        const orders = { blue: defaultOrders(s, d, 'blue'), red: aiOrders(view, d, p, rng) };
        const after = resolveRound(s, d, orders, aiAnswers(view, d, detectContacts(s, d, orders), p, rng)).state;
        expect(of(after, 'red', 'jungle').gold).toBeGreaterThan(0);
      }
    }
  });

  describe('start camp in round 1', () => {
    const run = (g: GameState, id: string, to: string) => {
      const orders = { blue: defaultOrders(g, d, 'blue'), red: defaultOrders(g, d, 'red') };
      orders.blue = orders.blue.map((o) => (o.champion === id && o.kind === 'move' ? { ...o, to } : o));
      return resolveRound(g, d, orders, {});
    };
    /** A position at least 2 steps from `from` that the champion can reach. */
    const farAway = (g: GameState, id: string, from: string) => {
      const reach = reachableFrom(d, from, stepBudget(d.rules, g.round), 'blue');
      return Object.entries(reach).find(([, cost]) => cost >= 2)![0];
    };

    test('a jungler placed on a camp clears it wherever it moves, with no action on arrival', () => {
      const g = placeChampions(newGame(d, 5), d, 'blue', { [of(newGame(d, 5), 'blue', 'jungle').id]: 'wolves-blue' });
      const bj = of(g, 'blue', 'jungle');
      const to = farAway(g, bj.id, 'wolves-blue');
      const { state, events } = run(g, bj.id, to);
      expect(events).toContainEqual({ type: 'campCleared', camp: 'wolves-blue', champion: bj.id });
      expect(events.filter((e) => e.type === 'campCleared' && e.champion === bj.id)).toHaveLength(1);
      expect(of(state, 'blue', 'jungle').position).toBe(to);
      expect(events).toContainEqual(expect.objectContaining({ type: 'moved', champion: bj.id, acted: false }));
      expect(state.camps['wolves-blue']).toBeGreaterThan(d.rules.camps.firstSpawnByCamp.wolves);
    });

    test('a laner placed on a camp clears it and gives up its round-1 farm', () => {
      const g0 = newGame(d, 5);
      const top = of(g0, 'blue', 'top');
      const g = placeChampions(g0, d, 'blue', { [top.id]: 'gromp-blue' });
      const { state, events } = run(g, top.id, 'top-lane');
      expect(events).toContainEqual({ type: 'campCleared', camp: 'gromp-blue', champion: top.id });
      const lone = run(g0, top.id, 'top-lane').state;
      expect(events).toContainEqual(expect.objectContaining({ type: 'moved', champion: top.id, acted: false }));
      expect(state.camps['gromp-blue']).toBeGreaterThan(d.rules.camps.firstSpawnByCamp.gromp);
      expect(lone.camps['gromp-blue']).toBe(d.rules.camps.firstSpawnByCamp.gromp);
      // The camp pays instead of the wave: less than the same laner farming its lane in round 1.
      expect(of(state, 'blue', 'top').gold).toBeLessThan(of(lone, 'blue', 'top').gold);
      expect(of(state, 'blue', 'top').xp).toBeLessThan(of(lone, 'blue', 'top').xp);
    });

    test('an enemy arriving on the camp finds it cleared; later rounds do not clear on departure', () => {
      const g = placeChampions(newGame(d, 5), d, 'blue', { [of(newGame(d, 5), 'blue', 'jungle').id]: 'wolves-blue' });
      const bj = of(g, 'blue', 'jungle');
      const after = run(g, bj.id, 'bluebuff-blue').state;
      const r2 = resolveRound(after, d, { blue: defaultOrders(after, d, 'blue'), red: defaultOrders(after, d, 'red') }, {});
      expect(r2.events.filter((e) => e.type === 'campCleared' && e.camp === 'wolves-blue')).toHaveLength(0);
    });
  });
});
