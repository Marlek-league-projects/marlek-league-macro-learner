import { describe, expect, test } from 'bun:test';
import { loadGameData, MISTAKE_IDS } from '@lml/data';
import type { AiProfile, Rank } from '@lml/data/contracts';
import {
  aiContactChoice,
  aiOrders,
  createRng,
  defaultOrders,
  detectContacts,
  newGame,
  resolveRound,
  validateOrders,
  viewFor,
} from '@lml/engine';
import type { ChampionState, ContactChoices, GameState, Order, Orders, Rng } from '@lml/engine/contracts';

const d = loadGameData();
const profile = (rank: Rank): AiProfile => d.aiProfiles.find((p) => p.rank === rank)!;
const get = (s: GameState, side: string, role: string): ChampionState =>
  s.champions.find((c) => c.side === side && role === c.role)!;
const place = (s: GameState, side: string, role: string, pos: string): void => {
  const c = get(s, side, role);
  c.position = pos;
  c.previous = pos;
};
const orderOf = (orders: Order[], id: string): Order => orders.find((o) => o.champion === id)!;

/** Rng whose n-th draw is `f(n)`. */
function stubRng(f: (n: number) => number): Rng {
  let n = 0;
  const next = (): number => f(n++);
  return { next, int: (k) => Math.floor(next() * k), pick: (xs) => xs[Math.floor(next() * xs.length)]!, state: () => n };
}

/** Fuzz seeds per rank; 30 in the brief, kept as long as the suite stays under its time budget. */
const SEEDS = 30;

describe('aiOrders fuzz', () => {
  for (const p of d.aiProfiles) {
    test(`${p.rank}: AI vs AI games give valid orders and end`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        let s = newGame(d, seed);
        const rng = { blue: createRng(seed), red: createRng(seed + 1000) };
        while (!s.over) {
          const orders: Orders = {
            blue: aiOrders(viewFor(s, d, 'blue'), d, p, rng.blue),
            red: aiOrders(viewFor(s, d, 'red'), d, p, rng.red),
          };
          validateOrders(s, d, 'blue', orders.blue);
          validateOrders(s, d, 'red', orders.red);
          const choices: ContactChoices = {};
          for (const c of detectContacts(s, d, orders)) {
            choices[c.id] = {
              blue: aiContactChoice(viewFor(s, d, 'blue'), d, c, p, rng.blue),
              red: aiContactChoice(viewFor(s, d, 'red'), d, c, p, rng.red),
            };
          }
          s = resolveRound(s, d, orders, choices).state;
        }
        expect(s.over).toBe(true);
        expect(s.winner).not.toBeNull();
      }
    }, 20_000);
  }
});

describe('aiOrders', () => {
  test('an invisible enemy position does not change the orders', () => {
    const base = newGame(d, 3);
    const rj = get(base, 'red', 'jungle').id;
    const r = resolveRound(base, d, { blue: defaultOrders(base, d, 'blue'), red: defaultOrders(base, d, 'red') }, {});
    const a = r.state;
    const b = structuredClone(a);
    place(a, 'red', 'jungle', 'krugs-red');
    place(b, 'red', 'jungle', 'wolves-red');
    expect(viewFor(a, d, 'blue').enemies.find((e) => e.id === rj)!.visible).toBe(false);
    for (const rank of ['iron', 'challenger'] as Rank[]) {
      const oa = aiOrders(viewFor(a, d, 'blue'), d, profile(rank), createRng(42));
      const ob = aiOrders(viewFor(b, d, 'blue'), d, profile(rank), createRng(42));
      expect(oa).toEqual(ob);
    }
  });

  function dragonOrder(botWave: -1 | 0 | 1): Order {
    const s = newGame(d, 7);
    s.round = 10; // dragon spawns at 300 s, in round 11
    s.waves.bot = botWave;
    place(s, 'blue', 'jungle', 'raptors-blue');
    const orders = aiOrders(viewFor(s, d, 'blue'), d, profile('challenger'), stubRng(() => 0.99));
    validateOrders(s, d, 'blue', orders);
    return orderOf(orders, get(s, 'blue', 'jungle').id);
  }

  test('challenger jungler moves to dragon one round before it spawns when bot has priority', () => {
    expect(dragonOrder(1)).toMatchObject({ kind: 'move', to: 'dragon-pit', ward: 'to', unward: 'to' });
  });

  test('without bot priority the challenger jungler does not set up dragon', () => {
    expect(dragonOrder(-1)).not.toMatchObject({ to: 'dragon-pit' });
  });

  function greedScenario(): GameState {
    const s = newGame(d, 7);
    s.round = 10;
    s.waves.top = 1;
    place(s, 'blue', 'top', 'top-t1-red');
    place(s, 'red', 'top', 'top-t2-red');
    s.lastSeen.blue[get(s, 'red', 'top').id] = { position: 'top-t2-red', round: 9 };
    // The red jungler was last seen at the start of the game.
    return s;
  }

  test('iron greed keeps pushing the enemy tower with the jungler unseen; challenger backs off', () => {
    const s = greedScenario();
    const bt = get(s, 'blue', 'top').id;
    const greed = MISTAKE_IDS.indexOf('greed');
    const onlyGreed = stubRng((n) => (n % MISTAKE_IDS.length === greed ? 0 : 0.99));
    const iron = aiOrders(viewFor(s, d, 'blue'), d, profile('iron'), onlyGreed);
    validateOrders(s, d, 'blue', iron);
    expect(orderOf(iron, bt)).toMatchObject({ kind: 'move', to: 'top-t1-red' });

    const challenger = aiOrders(viewFor(s, d, 'blue'), d, profile('challenger'), stubRng(() => 0.99));
    validateOrders(s, d, 'blue', challenger);
    expect(orderOf(challenger, bt)).toMatchObject({ kind: 'move', to: 'top-lane' });
  });
});

describe('aiContactChoice', () => {
  test('outnumbered: iron chases the kill, challenger flees', () => {
    const s = newGame(d, 7);
    s.round = 10;
    place(s, 'blue', 'top', 'top-t1-blue');
    place(s, 'red', 'top', 'top-t1-red');
    place(s, 'red', 'jungle', 'top-t2-red');
    const ids = { bt: get(s, 'blue', 'top').id, rt: get(s, 'red', 'top').id, rj: get(s, 'red', 'jungle').id };
    const over = (side: 'blue' | 'red', o: Order[]): Order[] =>
      defaultOrders(s, d, side).map((x) => o.find((y) => y.champion === x.champion) ?? x);
    const orders: Orders = {
      blue: over('blue', [{ kind: 'move', champion: ids.bt, to: 'top-lane' }]),
      red: over('red', [
        { kind: 'move', champion: ids.rt, to: 'top-lane' },
        { kind: 'move', champion: ids.rj, to: 'top-lane' },
      ]),
    };
    const contact = detectContacts(s, d, orders).find((c) => c.position === 'top-lane')!;
    expect(contact.blue).toEqual([ids.bt]);
    expect(contact.red).toHaveLength(2);
    const view = viewFor(s, d, 'blue');
    expect(aiContactChoice(view, d, contact, profile('iron'), stubRng(() => 0))).toBe('fight');
    expect(aiContactChoice(view, d, contact, profile('challenger'), stubRng(() => 0.99))).toBe('flee');
  });
});
