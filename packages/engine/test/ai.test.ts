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
  reachableFrom,
  resolveFight,
  resolveRound,
  roundWindow,
  stepBudget,
  validateOrders,
  viewFor,
} from '@lml/engine';
import type { ChampionState, ContactChoices, GameState, Order, Orders, PlayerView, Rng } from '@lml/engine/contracts';
import { assignStances, makeContext, planCandidates, rollMistakes, towerAllowed } from '../src/ai/heuristics';
import { updateVision } from '../src/vision';

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

/** Orders of `view.side` ending on an enemy tower `towerAllowed` forbids, as `round: champion kind from → to`. */
function towerViolations(view: PlayerView, orders: Order[]): string[] {
  const ctx = makeContext(view, d, false);
  const from = (id: string): string | undefined => view.allies.find((a) => a.id === id)?.position;
  return orders.flatMap((o) =>
    o.to !== undefined && !towerAllowed(ctx, o.to) ? [`${view.round}: ${o.champion} ${o.kind} ${from(o.champion)} → ${o.to}`] : [],
  );
}

/**
 * A full AI vs AI game at `p` for both sides; checks every round's orders against the real state and the tower
 * rule (no order ends under an enemy tower without the wave).
 */
function playGame(p: AiProfile, seed: number): GameState {
  let s = newGame(d, seed);
  const rng = { blue: createRng(seed), red: createRng(seed + 1000) };
  while (!s.over) {
    const views = { blue: viewFor(s, d, 'blue'), red: viewFor(s, d, 'red') };
    const orders: Orders = {
      blue: aiOrders(views.blue, d, p, rng.blue),
      red: aiOrders(views.red, d, p, rng.red),
    };
    validateOrders(s, d, 'blue', orders.blue);
    validateOrders(s, d, 'red', orders.red);
    expect([...towerViolations(views.blue, orders.blue), ...towerViolations(views.red, orders.red)]).toEqual([]);
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
    }, 60_000);

    test(`${p.rank}: the same seed plays the same game`, () => {
      const a = playGame(p, 11);
      const b = playGame(p, 11);
      expect(b.winner).toBe(a.winner);
      expect(b).toEqual(a);
    });
  }

  // Every mistake forced on every champion and round, one at a time and all together: still never under an enemy
  // tower without the wave (checked in `playGame`).
  const forced = (ids: readonly string[]): AiProfile => {
    const base = profile('gold');
    const mistakes = Object.fromEntries(MISTAKE_IDS.map((id) => [id, ids.includes(id) ? 1 : 0])) as AiProfile['mistakes'];
    return { ...base, mistakes };
  };
  for (const [name, ids] of [...MISTAKE_IDS.map((id) => [id, [id]] as const), ['every mistake', MISTAKE_IDS] as const]) {
    test(`forced ${name}: AI vs AI games respect the tower rule`, () => {
      for (let seed = 1; seed <= 5; seed++) expect(playGame(forced(ids), seed).over).toBe(true);
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

  function dragonOrder(botWave: -1 | 0 | 1, rank: Rank = 'challenger'): Order {
    const s = newGame(d, 7);
    s.round = 10; // dragon spawns at 300 s, in round 11
    s.waves.bot = botWave;
    place(s, 'blue', 'jungle', 'raptors-blue');
    const orders = aiOrders(viewFor(s, d, 'blue'), d, profile(rank), stubRng(() => 0.99));
    validateOrders(s, d, 'blue', orders);
    return orderOf(orders, get(s, 'blue', 'jungle').id);
  }

  // Laning phase: mid and the bot duo already commit to this Dragon as a wave sacrifice, so Challenger's two-round
  // look-ahead sends its jungler to the scuttle instead; Grandmaster (one round) keeps the jungler's objective rule.
  test('grandmaster jungler moves to dragon one round before it spawns when bot has priority', () => {
    expect(dragonOrder(1, 'grandmaster')).toMatchObject({ kind: 'move', to: 'dragon-pit', ward: 'to', unward: 'to' });
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

  test('a pit held by a known enemy group that beats ours is skipped; with no enemy seen there it is set up', () => {
    const jungleSetsUp = (enemiesAtPit: boolean): boolean => {
      const s = newGame(d, 7);
      s.round = 10; // Dragon spawns next round
      s.waves.bot = 1;
      place(s, 'blue', 'jungle', 'raptors-blue');
      // Top and mid start within a jungler's move of the pit: away, the jungler would fight alone.
      for (const role of ['top', 'mid', 'adc', 'support']) get(s, 'blue', role).status = 'respawning';
      if (enemiesAtPit) {
        for (const role of ['jungle', 'adc', 'support']) {
          place(s, 'red', role, 'dragon-pit');
          s.lastSeen.blue[get(s, 'red', role).id] = { position: 'dragon-pit', round: 9 };
        }
      }
      const view = viewFor(s, d, 'blue');
      const none = new Map(view.allies.map((a) => [a.id, new Set<(typeof MISTAKE_IDS)[number]>()]));
      const per = planCandidates(makeContext(view, d, true), none, createRng(0));
      const i = view.allies.filter((c) => c.status !== 'dead').findIndex((c) => c.role === 'jungle');
      return per[i]!.some((x) => x.score === d.aiTuning.priorities.objective);
    };
    expect(jungleSetsUp(false)).toBe(true);
    expect(jungleSetsUp(true)).toBe(false);
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

  test('challenger mid sacrifices its wave to rotate to a dragon where its side has the numbers, after the laning phase', () => {
    expect(d.rules.objectives.dragon.value).toBeGreaterThan(d.aiTuning.waveSacrificeCost);
    // Laning phase: the mid rotates only with priority, and its wave is crashing in.
    const laning = midOrder(sacrificeScenario());
    expect(laning.kind === 'move' && d.graph.positions[laning.to]!.lane).toBe('mid');
    const late = sacrificeScenario();
    late.round = 28; // 910–970 s
    late.pits['dragon-pit'].nextSpawn = 1000; // spawns next round
    for (const role of ['adc', 'support']) late.lastSeen.blue[get(late, 'red', role).id]!.round = 27;
    const o = midOrder(late);
    expect(o.kind).toBe('move');
    const to = (o as Extract<Order, { kind: 'move' }>).to;
    // The mid T1 reaches the pit in 1 move, like the Scuttle: it steps straight into it.
    expect(to).toBe('dragon-pit');
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
    const o = midOrder(s);
    expect(o.kind).toBe('move');
    expect(d.graph.positions[(o as Extract<Order, { kind: 'move' }>).to]!.lane).toBe('mid');
  });

  /** Top T1s are two moves from the Dragon pit through the jungle: keep the Dragon away so no rotation pays. */
  function noDragonSoon(s: GameState): void {
    s.pits['dragon-pit'].nextSpawn = 600;
  }

  /** Blue top on its lane, the red top seen in lane at the start of round 9 and gone since. */
  function vanishedLaner(wave: -1 | 0 | 1, bluePos: string): GameState {
    const s = newGame(d, 7);
    s.round = 10;
    s.waves.top = wave;
    place(s, 'blue', 'top', bluePos);
    place(s, 'red', 'top', 'krugs-red');
    s.lastSeen.blue[get(s, 'red', 'top').id] = { position: 'top-t1-red', round: 8 };
    noDragonSoon(s);
    return s;
  }

  test('an enemy laner gone from lane is no reason to push with the wave at home or the jungler unknown', () => {
    for (const wave of [-1, 0] as const) {
      const s = vanishedLaner(wave, 'top-t1-blue');
      const orders = aiOrders(viewFor(s, d, 'blue'), d, profile('challenger'), stubRng(() => 0.99));
      expect(orderOf(orders, get(s, 'blue', 'top').id)).toMatchObject({ kind: 'move', to: 'top-t1-blue' });
    }
  });

  test('after the enemy laner vanished next to us, with the jungler seen far away, the challenger takes the tower only with its wave there', () => {
    const conversion = (wave: 0 | 1): Order => {
      const s = vanishedLaner(wave, 'top-lane');
      s.lastSeen.blue[get(s, 'red', 'jungle').id] = { position: 'bot-t2-red', round: 9 };
      place(s, 'red', 'jungle', 'bot-t2-red');
      expect(d.graph.distance('bot-t2-red', 'top-t1-red')).toBeGreaterThan(stepBudget(d.rules, s.round));
      const orders = aiOrders(viewFor(s, d, 'blue'), d, profile('challenger'), stubRng(() => 0.99));
      return orderOf(orders, get(s, 'blue', 'top').id);
    };
    expect(conversion(1)).toMatchObject({ kind: 'move', to: 'top-t1-red' });
    expect(conversion(0)).not.toMatchObject({ to: 'top-t1-red' });
  });

  function greedScenario(): GameState {
    const s = newGame(d, 7);
    s.round = 10;
    s.waves.top = 1;
    place(s, 'blue', 'top', 'top-t1-red');
    place(s, 'red', 'top', 'top-t2-red');
    s.lastSeen.blue[get(s, 'red', 'top').id] = { position: 'top-t2-red', round: 9 };
    // The red jungler was last seen at the start of the game.
    noDragonSoon(s);
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
    noDragonSoon(s);
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

describe('laning phase', () => {
  const lastLaningRound = 26; // 810–850 s; round 27 starts at 850 s, past laningPhaseUntil
  /** No mistake rolled, and every random pick takes the first option. */
  const onlyMistake = (id?: (typeof MISTAKE_IDS)[number]): Rng =>
    stubRng((n) => (n < 5 * MISTAKE_IDS.length ? (id && n % MISTAKE_IDS.length === MISTAKE_IDS.indexOf(id) ? 0 : 0.99) : 0));

  test('laningPhaseUntil is 14:00 and covers rounds 1 to 26', () => {
    expect(d.aiTuning.laningPhaseUntil).toBe(840);
  });


  /**
   * Why a laner may move off its lane in the laning phase: toward (or onto) a pit whose objective is up or spawns next round
   * (the Emerald+ wave sacrifice), or back toward its farming spots (lane middle or own T1) from off the lane; null when it is a roam.
   */
  function offLaneReason(s: GameState, from: string, to: string): 'sacrifice' | 'return' | null {
    const next = roundWindow(d.rules, s.round + 1).end;
    for (const pit of ['dragon-pit', 'baron-pit'] as const) {
      const p = s.pits[pit];
      const up = p.objective !== null || (p.nextSpawn !== null && p.nextSpawn <= next);
      if (up && (to === pit || d.graph.distance(to, pit) < d.graph.distance(from, pit))) return 'sacrifice';
    }
    const back = ['top-lane', 'top-t1-blue'].some((t) => d.graph.distance(to, t) < d.graph.distance(from, t));
    return d.graph.positions[from]!.lane !== 'top' && back ? 'return' : null;
  }

  test('a challenger top laner stays on top lane positions in rounds 1 to 26, except to recall, respawn or sacrifice its wave', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      let s = newGame(d, seed);
      const top = get(s, 'blue', 'top').id;
      const red = createRng(seed + 1000);
      const trail: string[] = [];
      while (s.round <= lastLaningRound) {
        const orders: Orders = {
          blue: aiOrders(viewFor(s, d, 'blue'), d, profile('challenger'), stubRng(() => 0.99)),
          red: aiOrders(viewFor(s, d, 'red'), d, profile('challenger'), red),
        };
        const o = orderOf(orders.blue, top);
        const from = get(s, 'blue', 'top').position;
        trail.push(`${s.round}:${o.kind === 'move' ? `${from}->${o.to}` : o.kind}`);
        if (o.kind === 'move') {
          const pos = d.graph.positions[o.to]!;
          const inLane = pos.lane === 'top' || pos.kind === 'base';
          const ok = inLane || offLaneReason(s, from, o.to) !== null;
          expect(ok ? 'ok' : `seed ${seed}: ${trail.join(' ')}`).toBe('ok');
        }
        const choices: ContactChoices = {};
        for (const c of detectContacts(s, d, orders)) {
          choices[c.id] = {
            blue: aiContactChoice(viewFor(s, d, 'blue'), d, c, profile('challenger'), stubRng(() => 0.99)),
            red: aiContactChoice(viewFor(s, d, 'red'), d, c, profile('challenger'), red),
          };
        }
        s = resolveRound(s, d, orders, choices).state;
      }
    }
  }, 20_000);

  /**
   * Round 10, Dragon spawning next round, blue bot lane on its pushed wave at the red T1 (priority). The other
   * blue champions are dead and the red jungler and bot duo were just seen at the pit: no rotation gives the numbers.
   */
  function dragonWithPriority(): GameState {
    const s = newGame(d, 7);
    s.round = 10;
    s.waves.bot = 1;
    for (const role of ['jungle', 'top', 'mid']) get(s, 'blue', role).status = 'dead';
    for (const role of ['adc', 'support']) place(s, 'blue', role, 'bot-t1-red');
    for (const role of ['jungle', 'adc', 'support']) {
      place(s, 'red', role, 'dragon-pit');
      s.lastSeen.blue[get(s, 'red', role).id] = { position: 'dragon-pit', round: 9 };
    }
    return s;
  }
  const adcOrder = (s: GameState, rank: Rank, rng: Rng): Order => {
    const orders = aiOrders(viewFor(s, d, 'blue'), d, profile(rank), rng);
    validateOrders(s, d, 'blue', orders);
    return orderOf(orders, get(s, 'blue', 'adc').id);
  };
  /** Off the lane, a move closer to the Dragon pit than `from` (bot-t1-red reaches it in one move, like the Scuttle). */
  const towardDragon = (o: Order, from = 'bot-t1-red'): boolean =>
    o.kind === 'move' &&
    d.graph.positions[o.to]!.lane === undefined &&
    d.graph.distance(o.to, 'dragon-pit') < d.graph.distance(from, 'dragon-pit');

  /**
   * The ADC's chosen candidate is the objective rotation. From bot-t1-red the rotation now walks through bot-lane
   * (lane positions win route ties), the same first step as falling back to its own tower, so the order alone
   * cannot tell them apart: this replays aiOrders' mistake rolls and candidate ranking.
   */
  const adcRotates = (s: GameState, rank: Rank, rng: Rng): boolean => {
    const view = viewFor(s, d, 'blue');
    const p = profile(rank);
    const mistakes = rollMistakes(view, p, rng);
    const per = planCandidates(makeContext(view, d, p.waveSacrifice), mistakes, rng);
    const i = view.allies.filter((c) => c.status !== 'dead').findIndex((c) => c.role === 'adc');
    return per[i]![0]!.score === d.aiTuning.priorities.objective;
  };

  test('a rotation to a Dragon with priority is rejected during the laning phase, taken after it', () => {
    // Diamond: wave sacrifice on, no look-ahead to second-guess the objective rule.
    for (const rank of ['diamond', 'challenger'] as Rank[]) {
      const o = adcOrder(dragonWithPriority(), rank, onlyMistake());
      expect(adcRotates(dragonWithPriority(), rank, onlyMistake())).toBe(false);
      expect(o.kind === 'move' && d.graph.positions[o.to]!.lane).toBe('bot');
    }

    const late = dragonWithPriority();
    late.round = 28; // 910–970 s
    late.pits['dragon-pit'].nextSpawn = 1000; // spawns next round
    for (const role of ['jungle', 'adc', 'support']) late.lastSeen.blue[get(late, 'red', role).id]!.round = 27;
    // The red group just seen at the pit would win the fight there: no rotation into it.
    expect(adcRotates(late, 'diamond', onlyMistake())).toBe(false);
    for (const role of ['jungle', 'adc', 'support']) late.lastSeen.blue[get(late, 'red', role).id]!.round = 20;
    expect(adcOrder(late, 'diamond', onlyMistake())).toMatchObject({ kind: 'move', to: 'dragon-pit' });
    expect(adcRotates(late, 'diamond', onlyMistake())).toBe(true);
  });

  test('a paying wave sacrifice is kept to the laner\'s half of the map: top stays, mid (with priority) rotates to the Dragon', () => {
    const s = newGame(d, 7);
    s.round = 10; // Dragon spawns next round; no enemy seen, the rotation gives the numbers
    s.waves.mid = 1; // blue mid has priority
    place(s, 'blue', 'jungle', 'raptors-blue');
    expect(d.graph.distance('top-t1-blue', 'dragon-pit')).toBeLessThanOrEqual(stepBudget(d.rules, s.round));
    const orders = aiOrders(viewFor(s, d, 'blue'), d, profile('diamond'), onlyMistake());
    validateOrders(s, d, 'blue', orders);
    const top = orderOf(orders, get(s, 'blue', 'top').id);
    expect(top.kind === 'move' && d.graph.positions[top.to]!.lane).toBe('top');
    expect(towardDragon(orderOf(orders, get(s, 'blue', 'mid').id), 'mid-t1-blue')).toBe(true);
  });

  test('in the laning phase the mid laner rotates only with priority: no wave sacrifice', () => {
    const midRotates = (wave: -1 | 0 | 1): boolean => {
      const s = newGame(d, 7);
      s.round = 10; // Dragon spawns next round; no enemy seen, the rotation gives the numbers
      s.waves.mid = wave;
      place(s, 'blue', 'jungle', 'raptors-blue');
      const view = viewFor(s, d, 'blue');
      const rng = onlyMistake();
      const per = planCandidates(makeContext(view, d, true), rollMistakes(view, profile('diamond'), rng), rng);
      const i = view.allies.findIndex((c) => c.role === 'mid');
      return per[i]![0]!.score === d.aiTuning.priorities.objective;
    };
    expect(midRotates(1)).toBe(true);
    expect(midRotates(0)).toBe(false);
    expect(midRotates(-1)).toBe(false);
  });

  test('a laner rotating to a pit steps straight into it from its T1, like the Scuttle', () => {
    const s = newGame(d, 7);
    s.round = 14; // Voidgrubs up; no enemy seen, so the top's wave sacrifice gives the numbers
    s.pits['baron-pit'] = { objective: 'voidgrubs', nextSpawn: null, capture: null };
    place(s, 'blue', 'top', 'top-t1-blue');
    place(s, 'blue', 'jungle', 'bluebuff-blue');
    expect(d.graph.distance('top-t1-blue', 'baron-pit')).toBe(1);
    const orders = aiOrders(viewFor(s, d, 'blue'), d, profile('diamond'), onlyMistake());
    validateOrders(s, d, 'blue', orders);
    expect(orderOf(orders, get(s, 'blue', 'top').id)).toMatchObject({ kind: 'move', to: 'baron-pit' });
  });

  test('rotateWithoutPriority still breaks the laning-phase rule', () => {
    const s = dragonWithPriority();
    s.waves.bot = -1;
    for (const role of ['jungle', 'adc', 'support']) s.lastSeen.blue[get(s, 'red', role).id] = null; // no group to fear
    expect(adcRotates(s, 'iron', onlyMistake('rotateWithoutPriority'))).toBe(true);
  });

  test('a forced pointlessPlay wanders only within its own camps, the river and its own lane, never under a tower without the wave', () => {
    const wanders = new Set<string>();
    for (const [role, from] of [['top', 'top-lane'], ['top', 'top-t1-blue'], ['jungle', 'raptors-blue'], ['jungle', 'gromp-blue']]) {
      for (let k = 0; k < 10; k++) {
        const s = newGame(d, 7);
        s.round = 10;
        s.waves.top = 0;
        place(s, 'blue', role!, from!);
        const c = get(s, 'blue', role!);
        // Only the pointlessPlay roll comes up, then the pick draws k/10.
        const pick = stubRng((n) =>
          n < MISTAKE_IDS.length * 5 ? (n % MISTAKE_IDS.length === MISTAKE_IDS.indexOf('pointlessPlay') ? 0 : 0.99) : k / 10,
        );
        const view = viewFor(s, d, 'blue');
        const orders = aiOrders(view, d, profile('iron'), pick);
        validateOrders(s, d, 'blue', orders);
        const o = orderOf(orders, c.id);
        expect(o.kind).toBe('move');
        const to = (o as Extract<Order, { kind: 'move' }>).to;
        const p = d.graph.positions[to]!;
        const allowed =
          (p.kind === 'camp' && p.side === 'blue') || p.kind === 'scuttle' || p.kind === 'pit' || (role === 'top' && p.lane === 'top');
        expect({ to, allowed }).toEqual({ to, allowed: true });
        expect(towerAllowed(makeContext(view, d, false), to)).toBe(true);
        wanders.add(to);
      }
    }
    // It still wanders: several different spots, and never the enemy T1 (the top wave is in the middle).
    expect(wanders.size).toBeGreaterThan(3);
    expect(wanders.has('top-t1-red')).toBe(false);
  });
});

describe('aiContactChoice', () => {
  test('outnumbered: iron chases the kill, challenger flees', () => {
    const s = newGame(d, 7);
    s.round = 10;
    place(s, 'blue', 'top', 'top-t1-blue');
    place(s, 'red', 'top', 'top-t1-red');
    place(s, 'red', 'jungle', 'scuttle-top');
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

describe('AI lane stances', () => {
  /** Red top on top-lane, blue top seen there; red's lead is shifted by `bonus`. */
  function stanceOf(bonus: number, before: 'farm' | 'trade' | 'allin' = 'farm', tuning = d): Order {
    const s = newGame(d, 7);
    s.round = 10;
    s.waves.top = 0;
    s.pits['dragon-pit'].nextSpawn = 600;
    place(s, 'blue', 'top', 'top-lane');
    place(s, 'red', 'top', 'top-lane');
    const rt = get(s, 'red', 'top');
    rt.bonusLead += bonus;
    rt.stance = before;
    s.lastSeen.red[get(s, 'blue', 'top').id] = { position: 'top-lane', round: 9 };
    const orders = aiOrders(viewFor(s, tuning, 'red'), tuning, profile('iron'), stubRng(() => 0.99));
    validateOrders(s, tuning, 'red', orders);
    return orderOf(orders, rt.id);
  }
  const tuned = (allInMargin: number, tradeMargin: number) => ({ ...d, aiTuning: { ...d.aiTuning, allInMargin, tradeMargin } });

  test('a margin above allInMargin sets All-in', () => {
    expect(stanceOf(100_000)).toMatchObject({ kind: 'move', stance: 'allin' });
  });
  test('a margin between tradeMargin and allInMargin sets Trade', () => {
    expect(stanceOf(100_000, 'farm', tuned(1_000_000, 0))).toMatchObject({ stance: 'trade' });
  });
  test('a small margin or a predicted loss goes back to Farm; an unchanged stance is not repeated', () => {
    expect(stanceOf(-100_000, 'allin')).toMatchObject({ stance: 'farm' });
    expect(stanceOf(100_000, 'trade', tuned(1_000_000, 1_000_000))).toMatchObject({ stance: 'farm' });
    expect(stanceOf(-100_000, 'farm').stance).toBeUndefined();
  });

  /** Red top with lane pressure under Trade; the blue jungler seen at `jungler` in round `seen` (null: never seen). */
  function pushOf(jungler: string | null, seen = 9): Order {
    const s = newGame(d, 7);
    s.round = 10;
    s.waves.top = 0;
    s.pits['dragon-pit'].nextSpawn = 600;
    place(s, 'blue', 'top', 'top-lane');
    place(s, 'red', 'top', 'top-lane');
    get(s, 'red', 'top').bonusLead += 100_000;
    s.lastSeen.red[get(s, 'blue', 'top').id] = { position: 'top-lane', round: 9 };
    // The red jungler, 2 steps from the lane middle, ganks the blue top there and the red top joins it.
    place(s, 'red', 'jungle', 'raptors-red');
    const bj = get(s, 'blue', 'jungle');
    if (jungler) {
      place(s, 'blue', 'jungle', jungler);
      s.lastSeen.red[bj.id] = { position: jungler, round: seen };
    }
    const tuning = tuned(1_000_000, 1_000_000);
    const orders = aiOrders(viewFor(s, tuning, 'red'), tuning, profile('iron'), stubRng(() => 0.99));
    validateOrders(s, tuning, 'red', orders);
    return orderOf(orders, get(s, 'red', 'top').id);
  }

  test('with lane pressure and the enemy jungler seen far away, the laner Pushes', () => {
    expect(d.graph.distance('dragon-pit', 'top-lane')).toBeGreaterThan(d.aiTuning.pushJunglerDistance);
    expect(pushOf('dragon-pit')).toMatchObject({ kind: 'move', to: 'top-lane', stance: 'push' });
  });

  test('no Push when the enemy jungler is close or unseen', () => {
    expect(d.graph.distance('scuttle-top', 'top-lane')).toBeLessThanOrEqual(d.aiTuning.pushJunglerDistance);
    expect(pushOf('scuttle-top').stance).toBeUndefined();
    expect(pushOf(null).stance).toBeUndefined();
  });

  test('a jungler last seen far away but longer ago than knownRounds is still a threat', () => {
    expect(pushOf('dragon-pit', 10 - d.aiTuning.knownRounds).stance).toBe('push');
    expect(pushOf('dragon-pit', 9 - d.aiTuning.knownRounds).stance).toBeUndefined();
  });
});

test('AI stance: a laner whose move leaves its home lane goes back to Farm', () => {
  const s = newGame(d, 7);
  s.round = 10;
  place(s, 'red', 'top', 'top-lane');
  const rt = get(s, 'red', 'top');
  rt.stance = 'allin';
  const view = viewFor(s, d, 'red');
  const ctx = makeContext(view, d, false);
  const orders = defaultOrders(s, d, 'red').map((o) => (o.champion === rt.id ? { kind: 'move' as const, champion: rt.id, to: 'scuttle-top' } : o));
  expect(orderOf(assignStances(ctx, orders), rt.id)).toEqual({ kind: 'move', champion: rt.id, to: 'scuttle-top', stance: 'farm' });
});

test('AI stance: opposite T1s are predicted at the lane middle, where the engine resolves the fight', () => {
  const s = newGame(d, 7);
  s.round = 10;
  place(s, 'blue', 'mid', 'mid-t1-blue');
  place(s, 'red', 'mid', 'mid-t1-red');
  updateVision(s, d);
  const [bm, rm] = [get(s, 'blue', 'mid').id, get(s, 'red', 'mid').id];
  const { scores } = resolveFight(s, d, 'mid-lane', [bm], [rm], roundWindow(d.rules, 10).stage);
  const margin = scores.blue - scores.red;
  // Blue is ahead at the lane middle (Trade), red behind (Farm); each T1 alone would promise an All-in.
  expect(margin).toBeGreaterThan(d.aiTuning.tradeMargin);
  expect(margin).toBeLessThan(d.aiTuning.allInMargin);
  for (const side of ['blue', 'red'] as const) {
    const me = side === 'blue' ? bm : rm;
    const to = side === 'blue' ? 'mid-t1-blue' : 'mid-t1-red';
    const orders = defaultOrders(s, d, side).map((o) => (o.champion === me ? { kind: 'move' as const, champion: me, to } : o));
    const stance = orderOf(assignStances(makeContext(viewFor(s, d, side), d, false), orders), me).stance;
    expect(stance).toBe(side === 'blue' ? 'trade' : undefined);
  }
});

test('AI stance: a recalling laner goes back to Farm, with or without a step first', () => {
  const s = newGame(d, 7);
  s.round = 10;
  place(s, 'red', 'top', 'top-lane');
  const rt = get(s, 'red', 'top');
  rt.stance = 'allin';
  const ctx = makeContext(viewFor(s, d, 'red'), d, false);
  for (const recall of [
    { kind: 'recall' as const, champion: rt.id, to: 'top-t1-red' },
    { kind: 'recall' as const, champion: rt.id },
  ]) {
    const orders = defaultOrders(s, d, 'red').map((o) => (o.champion === rt.id ? recall : o));
    validateOrders(s, d, 'red', orders);
    expect(orderOf(assignStances(ctx, orders), rt.id)).toEqual({ ...recall, stance: 'farm' });
  }
  rt.stance = 'farm';
  const farm = defaultOrders(s, d, 'red').map((o) => (o.champion === rt.id ? { kind: 'recall' as const, champion: rt.id } : o));
  expect(orderOf(assignStances(makeContext(viewFor(s, d, 'red'), d, false), farm), rt.id)).toEqual({ kind: 'recall', champion: rt.id });
});

describe('AI recall', () => {
  test('a laner on the lane middle steps back under its tower, then recalls', () => {
    const s = newGame(d, 7);
    s.round = 10;
    s.waves.top = 1;
    s.pits['dragon-pit'].nextSpawn = 600;
    place(s, 'blue', 'top', 'top-lane');
    const top = get(s, 'blue', 'top');
    top.gold = d.aiTuning.recallGold + 100;
    const orders = aiOrders(viewFor(s, d, 'blue'), d, profile('iron'), stubRng(() => 0.99));
    validateOrders(s, d, 'blue', orders);
    expect(orderOf(orders, top.id)).toEqual({ kind: 'recall', champion: top.id, to: 'top-t1-blue' });
  });

  test('a laner under recallHp recalls with no gold when its wave allows it, not with its wave pushed in', () => {
    const s = newGame(d, 7);
    s.round = 10;
    s.pits['dragon-pit'].nextSpawn = 600;
    place(s, 'blue', 'top', 'top-t1-blue');
    const top = get(s, 'blue', 'top');
    top.gold = 0;
    top.hp = d.aiTuning.recallHp - 1;
    s.waves.top = 1;
    const go = aiOrders(viewFor(s, d, 'blue'), d, profile('challenger'), stubRng(() => 0.99));
    expect(orderOf(go, top.id).kind).toBe('recall');
    s.waves.top = -1;
    const stay = aiOrders(viewFor(s, d, 'blue'), d, profile('challenger'), stubRng(() => 0.99));
    expect(orderOf(stay, top.id).kind).not.toBe('recall');
    s.waves.top = 1;
    top.hp = d.aiTuning.recallHp;
    const healthy = aiOrders(viewFor(s, d, 'blue'), d, profile('challenger'), stubRng(() => 0.99));
    expect(orderOf(healthy, top.id).kind).not.toBe('recall');
  });

  test('a gold-rank laner under recallHp also recalls on a pushed wave', () => {
    const s = newGame(d, 7);
    s.round = 10;
    s.pits['dragon-pit'].nextSpawn = 600;
    s.waves.top = 1;
    place(s, 'blue', 'top', 'top-t1-blue');
    const top = get(s, 'blue', 'top');
    top.gold = 0;
    top.hp = d.aiTuning.recallHp - 1;
    const orders = aiOrders(viewFor(s, d, 'blue'), d, profile('gold'), stubRng(() => 0.99));
    validateOrders(s, d, 'blue', orders);
    expect(orderOf(orders, top.id).kind).toBe('recall');
  });
});

describe('AI gank choice and lane exposure', () => {
  /** Red jungle ganks blue top on top-lane; red's top stays home, so it is 1 jungler vs 1 top. */
  function gank(wave: -1 | 0 | 1, lead: number): { s: GameState; orders: Orders } {
    const s = newGame(d, 7);
    s.round = 10;
    for (const c of s.champions) {
      c.xp = 0; c.items = 0; c.bonusLead = 0;
    }
    place(s, 'blue', 'top', 'top-t1-blue');
    place(s, 'red', 'jungle', 'scuttle-top');
    place(s, 'red', 'top', 'top-t1-red');
    s.waves.top = wave;
    get(s, 'red', 'jungle').bonusLead = lead;
    const over: Order[] = [
      { kind: 'move', champion: get(s, 'blue', 'top').id, to: 'top-lane' },
      { kind: 'move', champion: get(s, 'red', 'jungle').id, to: 'top-lane' },
      { kind: 'move', champion: get(s, 'red', 'top').id, to: 'top-lane' },
    ];
    const f = (side: 'blue' | 'red'): Order[] =>
      defaultOrders(s, d, side).map((o) => over.find((x) => x.champion === o.champion) ?? o);
    return { s, orders: { blue: f('blue'), red: f('red') } };
  }
  const noChase = stubRng(() => 0.999);
  const redChoice = (wave: -1 | 0 | 1, lead: number) => {
    const { s, orders } = gank(wave, lead);
    const c = detectContacts(s, d, orders).find((x) => x.position === 'top-lane' && x.kind === 'gank')!;
    expect(c.options.red.length).toBeGreaterThan(1);
    return aiContactChoice(viewFor(s, d, 'red'), d, c, profile('challenger'), noChase);
  };
  /** Smallest red jungle lead (to 1 unit) at which the red ganker commits. */
  const threshold = (wave: -1 | 0 | 1): number => {
    let lo = -1_000_000;
    let hi = 1_000_000;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (redChoice(wave, mid) === 'fight') hi = mid;
      else lo = mid;
    }
    return hi;
  };

  test('the ganker counts the ganked laner pushed up as exposed: it commits with less lead', () => {
    const neutral = threshold(0);
    expect(threshold(1)).toBeLessThan(neutral);
    expect(threshold(-1)).toBe(neutral);
  });
});

describe('AI tower rule', () => {
  test('towerAllowed: an enemy tower only when it is the front tower with the wave at it; own and destroyed towers are fine', () => {
    const s = newGame(d, 7);
    s.round = 10;
    const ctx = (wave: -1 | 0 | 1): ReturnType<typeof makeContext> => {
      s.waves.top = wave;
      return makeContext(viewFor(s, d, 'blue'), d, false);
    };
    expect(towerAllowed(ctx(0), 'top-t1-red')).toBe(false);
    expect(towerAllowed(ctx(-1), 'top-t1-red')).toBe(false);
    expect(towerAllowed(ctx(1), 'top-t1-red')).toBe(true);
    expect(towerAllowed(ctx(1), 'top-t2-red')).toBe(false); // not the front tower while the T1 stands
    expect(towerAllowed(ctx(-1), 'top-t1-blue')).toBe(true);
    expect(towerAllowed(ctx(0), 'top-lane')).toBe(true);
    s.towers['top-t1-red'] = 0;
    expect(towerAllowed(ctx(0), 'top-t1-red')).toBe(true);
    expect(towerAllowed(ctx(0), 'top-t2-red')).toBe(false);
    expect(towerAllowed(ctx(1), 'top-t2-red')).toBe(true);
    // Mirrored for red.
    s.waves.bot = -1;
    expect(towerAllowed(makeContext(viewFor(s, d, 'red'), d, false), 'bot-t1-blue')).toBe(true);
    s.waves.bot = 0;
    expect(towerAllowed(makeContext(viewFor(s, d, 'red'), d, false), 'bot-t1-blue')).toBe(false);
  });

  test('the Herald waits for the wave: it is launched on the enemy front tower only with the wave there', () => {
    const heraldOrder = (wave: 0 | 1): Order => {
      const s = newGame(d, 7);
      s.round = 30;
      s.waves.top = wave;
      place(s, 'blue', 'top', 'top-lane');
      const top = get(s, 'blue', 'top');
      top.hasHerald = true;
      const orders = aiOrders(viewFor(s, d, 'blue'), d, profile('gold'), stubRng(() => 0.99));
      validateOrders(s, d, 'blue', orders);
      return orderOf(orders, top.id);
    };
    expect(heraldOrder(1)).toMatchObject({ kind: 'move', to: 'top-t1-red', launchHerald: true });
    const waiting = heraldOrder(0);
    expect(waiting).not.toMatchObject({ to: 'top-t1-red' });
    expect(waiting).not.toMatchObject({ launchHerald: true });
  });
});

describe('AI range-aware targets', () => {
  /** Blue jungler on `from` in round 10 (step budget 2); only `up` own camps are up. */
  function jungler(from: string, up: string[]): { s: GameState; id: string } {
    const s = newGame(d, 7);
    s.round = 10;
    s.pits['dragon-pit'].nextSpawn = 900;
    s.pits['baron-pit'].nextSpawn = 900;
    s.scuttles = { 'scuttle-top': 900, 'scuttle-bot': 900 };
    s.scuttlesSeen = { blue: { ...s.scuttles }, red: { ...s.scuttles } };
    for (const id of Object.keys(s.camps)) s.camps[id] = up.includes(id) ? 0 : 900;
    s.campsSeen.blue = { ...s.camps };
    s.campsSeen.red = { ...s.camps };
    place(s, 'blue', 'jungle', from);
    return { s, id: get(s, 'blue', 'jungle').id };
  }
  const candidates = (s: GameState, id: string) => {
    const view = viewFor(s, d, 'blue');
    const none = new Map(view.allies.map((a) => [a.id, new Set<(typeof MISTAKE_IDS)[number]>()]));
    const ctx = makeContext(view, d, false);
    return planCandidates(ctx, none, stubRng(() => 0.99))[view.allies.findIndex((a) => a.id === id)]!;
  };

  test('a camp 2 steps away at budget 2 is not a clear: it scores as a walk (walkPenalty), and a camp in action range wins', () => {
    expect(stepBudget(d.rules, 10)).toBe(2);
    const from = 'wolves-blue';
    const r = reachableFrom(d, from, 2, 'blue');
    const far = Object.keys(r).find((p) => r[p] === 2 && d.graph.positions[p]!.kind === 'camp' && d.graph.positions[p]!.side === 'blue')!;
    const near = Object.keys(r).find((p) => r[p] === 1 && d.graph.positions[p]!.kind === 'camp' && d.graph.positions[p]!.side === 'blue')!;
    expect([far, near].every(Boolean)).toBe(true);

    const alone = jungler(from, [far]);
    const walk = candidates(alone.s, alone.id).find((c) => c.order.kind === 'move' && c.order.to === far)!;
    const prio = /buff-/.test(far) ? d.aiTuning.priorities.buff : d.aiTuning.priorities.camp;
    expect(walk.score).toBe(prio - d.aiTuning.walkPenalty);

    // Make the far camp a buff-level target: the camp in action range still comes first.
    const both = jungler(from, [far, near]);
    const tuned = { ...d, aiTuning: { ...d.aiTuning, priorities: { ...d.aiTuning.priorities, buff: d.aiTuning.priorities.camp + 1 } } };
    const view = viewFor(both.s, tuned, 'blue');
    const best = orderOf(aiOrders(view, tuned, profile('gold'), stubRng(() => 0.99)), both.id);
    expect(best).toMatchObject({ kind: 'move', to: near });
  });

  test('a laner farms where it still acts: from its T1 with the wave pushed it stops on the lane middle, not 2 steps away', () => {
    const s = newGame(d, 7);
    s.round = 10;
    s.waves.top = 1;
    s.pits['baron-pit'].nextSpawn = 900;
    place(s, 'blue', 'top', 'top-t2-blue');
    // T2 → lane middle is 2 steps: arrival only, so the top stops on its T1 (1 step) and farms.
    expect(reachableFrom(d, 'top-t2-blue', 2, 'blue')['top-lane']).toBe(2);
    const orders = aiOrders(viewFor(s, d, 'blue'), d, profile('gold'), stubRng(() => 0.99));
    expect(orderOf(orders, get(s, 'blue', 'top').id)).toMatchObject({ kind: 'move', to: 'top-t1-blue' });
  });
});

describe('AI contact choices', () => {
  const noChase = stubRng(() => 0.999);
  /** Lone red adc on its own T1 against the blue duo arriving on the lane middle (a pressure, no ganker). */
  function underTower(): { s: GameState; orders: Orders } {
    const s = newGame(d, 7);
    s.round = 10;
    s.waves.bot = 1;
    place(s, 'blue', 'adc', 'bot-lane');
    place(s, 'blue', 'support', 'bot-lane');
    place(s, 'red', 'adc', 'bot-t1-red');
    place(s, 'red', 'support', 'raptors-red');
    const over: Order[] = ['adc', 'support'].map((r) => ({ kind: 'move', champion: get(s, 'blue', r).id, to: 'bot-lane' }));
    const f = (side: 'blue' | 'red'): Order[] => defaultOrders(s, d, side).map((o) => over.find((x) => x.champion === o.champion) ?? o);
    return { s, orders: { blue: f('blue'), red: f('red') } };
  }

  test('outnumbered under its own tower with no ganker, the AI farms; when that fight would kill it, it flees', () => {
    const { s, orders } = underTower();
    const c = detectContacts(s, d, orders).find((x) => x.id === 'lane-bot')!;
    expect(c.kind).toBe('pressure');
    expect(c.options.red).toContain('farm');
    const loose = { ...d, aiTuning: { ...d.aiTuning, allInMargin: 1_000_000 } };
    expect(aiContactChoice(viewFor(s, loose, 'red'), loose, c, profile('challenger'), noChase)).toBe('farm');
    const strict = { ...d, aiTuning: { ...d.aiTuning, allInMargin: 0 } };
    expect(aiContactChoice(viewFor(s, strict, 'red'), strict, c, profile('challenger'), noChase)).toBe('flee');
  });

  test('a gank it would lose is fled, even on its own tower', () => {
    const { s, orders } = underTower();
    place(s, 'blue', 'jungle', 'raptors-red');
    const bj = get(s, 'blue', 'jungle').id;
    orders.blue = orders.blue.map((o) => (o.champion === bj ? { kind: 'move', champion: bj, to: 'bot-lane' } : o));
    const loose = { ...d, aiTuning: { ...d.aiTuning, allInMargin: 1_000_000 } };
    const c = detectContacts(s, loose, orders).find((x) => x.id === 'lane-bot')!;
    expect(c.kind).toBe('gank');
    expect(c.options.red).toContain('farm');
    expect(aiContactChoice(viewFor(s, loose, 'red'), loose, c, profile('challenger'), noChase)).toBe('flee');
  });

  /** Round 11, Dragon up and held by the blue jungler since round 10; the red jungler arrives on the Scuttle. */
  function river(lead: number): { s: GameState; orders: Orders } {
    const s = newGame(d, 7);
    s.round = 11;
    place(s, 'blue', 'jungle', 'dragon-pit');
    place(s, 'red', 'jungle', 'bluebuff-red');
    s.pits['dragon-pit'] = { objective: 'dragon', nextSpawn: null, capture: { side: 'blue', startedRound: 10 } };
    const bj = get(s, 'blue', 'jungle');
    bj.bonusLead += lead;
    const rj = get(s, 'red', 'jungle').id;
    s.lastSeen.blue[rj] = { position: 'bluebuff-red', round: 10 };
    const over: Order[] = [
      { kind: 'move', champion: bj.id, to: 'dragon-pit' },
      { kind: 'move', champion: rj, to: 'scuttle-bot' },
    ];
    const f = (side: 'blue' | 'red'): Order[] => defaultOrders(s, d, side).map((o) => over.find((x) => x.champion === o.champion) ?? o);
    return { s, orders: { blue: f('blue'), red: f('red') } };
  }
  const blueChoice = (lead: number, objectiveFocus = d.rules.fight.objectiveFocus) => {
    const tuned = { ...d, rules: { ...d.rules, fight: { ...d.rules.fight, objectiveFocus } } };
    const { s, orders } = river(lead);
    const c = detectContacts(s, tuned, orders).find((x) => x.id === 'river-bot')!;
    expect(c.options.blue).toContain('objective');
    return aiContactChoice(viewFor(s, tuned, 'blue'), tuned, c, profile('challenger'), noChase);
  };

  test('on a contested river the AI keeps taking the objective when its score × objectiveFocus still wins', () => {
    expect(blueChoice(100_000)).toBe('objective');
    // Blue wins the plain fight (8.66 to 8.2 here) but not at half its strength: it fights instead.
    expect(blueChoice(0, 1)).toBe('objective');
    expect(blueChoice(0, 0.5)).toBe('fight');
    // Losing anyway: it flees.
    expect(blueChoice(-100_000)).toBe('flee');
  });

  test('on a river with nothing up, the AI does not choose objective', () => {
    const tuned = d;
    const { s, orders } = river(100_000);
    s.pits['dragon-pit'] = { objective: null, nextSpawn: 900, capture: null };
    s.scuttles = { 'scuttle-top': 900, 'scuttle-bot': 900 };
    s.scuttlesSeen = { blue: { ...s.scuttles }, red: { ...s.scuttles } };
    const c = detectContacts(s, tuned, orders).find((x) => x.id === 'river-bot')!;
    expect(c.options.blue).not.toContain('objective');
    expect(aiContactChoice(viewFor(s, tuned, 'blue'), tuned, c, profile('challenger'), noChase)).toBe('fight');
  });
});
