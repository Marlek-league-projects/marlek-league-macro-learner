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

/** A full AI vs AI game at `p` for both sides; checks every round's orders against the real state. */
function playGame(p: AiProfile, seed: number): GameState {
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
  return s;
}

describe('aiOrders fuzz', () => {
  for (const p of d.aiProfiles) {
    test(`${p.rank}: AI vs AI games give valid orders and end`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const s = playGame(p, seed);
        expect(s.over).toBe(true);
        expect(s.winner).not.toBeNull();
      }
    }, 20_000);

    test(`${p.rank}: the same seed plays the same game`, () => {
      const a = playGame(p, 11);
      const b = playGame(p, 11);
      expect(b.winner).toBe(a.winner);
      expect(b).toEqual(a);
    });
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

  test('a live dragon without bot priority does not pull the challenger jungler', () => {
    const s = newGame(d, 7);
    s.round = 12; // dragon spawned in round 11
    s.waves.bot = -1;
    place(s, 'blue', 'jungle', 'raptors-blue');
    const orders = aiOrders(viewFor(s, d, 'blue'), d, profile('challenger'), stubRng(() => 0.99));
    expect(orderOf(orders, get(s, 'blue', 'jungle').id)).not.toMatchObject({ to: 'dragon-pit' });
  });

  /**
   * Round 10, Dragon spawning next round, blue mid on its T1 with its wave crashing in. Blue jungler and adc are
   * near the pit (the support is dead): 2 against the red bot duo just seen in bot lane, 3 with the mid. The red
   * jungler was not seen for ages.
   */
  function sacrificeScenario(): GameState {
    const s = newGame(d, 7);
    s.round = 10;
    s.waves.mid = -1;
    place(s, 'blue', 'mid', 'mid-t1-blue');
    place(s, 'blue', 'jungle', 'raptors-blue');
    place(s, 'blue', 'adc', 'bot-t1-blue');
    get(s, 'blue', 'support').status = 'dead';
    for (const role of ['adc', 'support']) {
      place(s, 'red', role, 'bot-t1-red');
      s.lastSeen.blue[get(s, 'red', role).id] = { position: 'bot-t1-red', round: 9 };
    }
    return s;
  }
  const midOrder = (s: GameState, rank: Rank = 'challenger'): Order => {
    const orders = aiOrders(viewFor(s, d, 'blue'), d, profile(rank), stubRng(() => 0.99));
    validateOrders(s, d, 'blue', orders);
    return orderOf(orders, get(s, 'blue', 'mid').id);
  };

  test('challenger mid sacrifices its wave to rotate to a dragon where its side has the numbers', () => {
    expect(d.rules.objectives.dragon.value).toBeGreaterThan(d.aiTuning.waveSacrificeCost);
    expect(midOrder(sacrificeScenario())).toMatchObject({ kind: 'move', to: 'scuttle-bot' });
  });

  test('below Emerald the mid does not sacrifice its wave, even with no mistake rolled', () => {
    expect(profile('challenger').waveSacrifice).toBe(true);
    for (const rank of ['iron', 'gold'] as Rank[]) {
      expect(profile(rank).waveSacrifice).toBe(false);
      expect(midOrder(sacrificeScenario(), rank)).toMatchObject({ kind: 'move', to: 'mid-t1-blue' });
    }
  });

  test('challenger mid stays in lane with no objective up', () => {
    const s = sacrificeScenario();
    s.round = 7; // no pit objective up or spawning next round
    expect(midOrder(s)).toMatchObject({ kind: 'move', to: 'mid-t1-blue' });
  });

  test('challenger mid stays in lane when the rotation would not give the numbers', () => {
    const s = sacrificeScenario();
    for (const role of ['adc', 'jungle']) get(s, 'blue', role).status = 'dead';
    place(s, 'red', 'jungle', 'dragon-pit');
    s.lastSeen.blue[get(s, 'red', 'jungle').id] = { position: 'dragon-pit', round: 9 };
    expect(midOrder(s)).toMatchObject({ kind: 'move', to: 'mid-t1-blue' });
  });

  /** Blue top on its lane, the red top seen in lane at the start of round 9 and gone since. */
  function vanishedLaner(wave: -1 | 0 | 1, bluePos: string): GameState {
    const s = newGame(d, 7);
    s.round = 10;
    s.waves.top = wave;
    place(s, 'blue', 'top', bluePos);
    place(s, 'red', 'top', 'krugs-red');
    s.lastSeen.blue[get(s, 'red', 'top').id] = { position: 'top-t1-red', round: 8 };
    return s;
  }

  test('an enemy laner gone from lane is no reason to push with the wave at home or the jungler unknown', () => {
    for (const wave of [-1, 0] as const) {
      const s = vanishedLaner(wave, 'top-t1-blue');
      const orders = aiOrders(viewFor(s, d, 'blue'), d, profile('challenger'), stubRng(() => 0.99));
      expect(orderOf(orders, get(s, 'blue', 'top').id)).toMatchObject({ kind: 'move', to: 'top-t1-blue' });
    }
  });

  test('after the enemy laner vanished next to us, with the jungler seen far away, the challenger takes the tower', () => {
    const s = vanishedLaner(0, 'top-lane');
    s.lastSeen.blue[get(s, 'red', 'jungle').id] = { position: 'dragon-pit', round: 9 };
    place(s, 'red', 'jungle', 'dragon-pit');
    const orders = aiOrders(viewFor(s, d, 'blue'), d, profile('challenger'), stubRng(() => 0.99));
    expect(orderOf(orders, get(s, 'blue', 'top').id)).toMatchObject({ kind: 'move', to: 'top-t1-red' });
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

  test('the look-ahead keeps a rolled mistake', () => {
    // Blue top alone, wave crashing into its tower, gold to spend: badRecall recalls anyway.
    const s = newGame(d, 7);
    s.round = 10;
    s.waves.top = -1;
    for (const c of s.champions) if (c.side === 'blue' && c.role !== 'top') c.status = 'dead';
    const top = get(s, 'blue', 'top');
    top.gold = d.aiTuning.recallGold + 100;
    const bad = MISTAKE_IDS.indexOf('badRecall');
    const onlyBadRecall = stubRng((n) => (n % MISTAKE_IDS.length === bad ? 0 : 0.99));
    const view = viewFor(s, d, 'blue');
    // Master looks one round ahead, where staying to farm evaluates better than the recall.
    expect(orderOf(aiOrders(view, d, profile('master'), onlyBadRecall), top.id)).toMatchObject({ kind: 'recall' });
    expect(orderOf(aiOrders(view, d, profile('master'), stubRng(() => 0.99)), top.id)).toMatchObject({ kind: 'move' });
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

describe('aiContactChoice on an even lane contact', () => {
  /** Blue and red tops meet on top-lane; blue's lead is shifted by `bonus`. */
  function laneContact(bonus: number): { view: ReturnType<typeof viewFor>; contact: ReturnType<typeof detectContacts>[number] } {
    const s = newGame(d, 7);
    s.round = 10;
    place(s, 'blue', 'top', 'top-t1-blue');
    place(s, 'red', 'top', 'top-t1-red');
    get(s, 'blue', 'top').bonusLead += bonus;
    const ids = { bt: get(s, 'blue', 'top').id, rt: get(s, 'red', 'top').id };
    const over = (side: 'blue' | 'red', o: Order[]): Order[] =>
      defaultOrders(s, d, side).map((x) => o.find((y) => y.champion === x.champion) ?? x);
    const orders: Orders = {
      blue: over('blue', [{ kind: 'move', champion: ids.bt, to: 'top-lane' }]),
      red: over('red', [{ kind: 'move', champion: ids.rt, to: 'top-lane' }]),
    };
    const contact = detectContacts(s, d, orders).find((c) => c.position === 'top-lane')!;
    expect(contact.kind).toBe('trade');
    return { view: viewFor(s, d, 'blue'), contact };
  }
  const never = stubRng(() => 0.99);

  const tuned = (allInMargin: number, tradeMargin: number) => ({ ...d, aiTuning: { ...d.aiTuning, allInMargin, tradeMargin } });

  test('a margin above allInMargin goes all-in', () => {
    const { view, contact } = laneContact(100_000);
    expect(aiContactChoice(view, d, contact, profile('challenger'), never)).toBe('fight');
  });
  test('a predicted loss beyond allInMargin flees', () => {
    const { view, contact } = laneContact(-100_000);
    expect(aiContactChoice(view, d, contact, profile('challenger'), never)).toBe('flee');
  });
  test('a margin between tradeMargin and allInMargin trades', () => {
    const { view, contact } = laneContact(100_000);
    expect(aiContactChoice(view, tuned(1_000_000, 0), contact, profile('challenger'), never)).toBe('trade');
  });
  test('a margin within tradeMargin farms', () => {
    const { view, contact } = laneContact(100_000);
    expect(aiContactChoice(view, tuned(1_000_000, 1_000_000), contact, profile('challenger'), never)).toBe('farm');
    const loss = laneContact(-100_000);
    expect(aiContactChoice(loss.view, tuned(1_000_000, 0), loss.contact, profile('challenger'), never)).toBe('farm');
  });
});
