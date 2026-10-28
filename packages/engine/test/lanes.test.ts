import { describe, expect, test } from 'bun:test';
import { loadGameData, matchupAdvantage } from '@lml/data';
import type { Lane, Side } from '@lml/data/contracts';
import { frontTower, laneExposure, lanePressure, level, newGame, roundWindow, totalRounds, updateLanes } from '@lml/engine';
import type { ChampionState, GameEvent, GameState } from '@lml/engine/contracts';

const d = loadGameData();
const get = (s: GameState, side: Side, role: string): ChampionState =>
  s.champions.find((c) => c.side === side && c.role === role)!;
function fresh(round = 1): GameState {
  const s = newGame(d, 7);
  s.round = round;
  for (const c of s.champions) {
    c.xp = 0; c.items = 0; c.bonusLead = 0; c.gold = 0; c.goldEarned = 0; c.position = 'blue-base';
  }
  return s;
}
/** Every champion acts (a step left on arrival). */
const everyone = (s: GameState): Set<string> => new Set(s.champions.map((c) => c.id));
const run = (s: GameState, tw: Partial<Record<Lane, Side | null>> = {}, noPressure: Set<Lane> = new Set()): GameEvent[] => {
  const ev: GameEvent[] = [];
  updateLanes(s, d, tw, ev, noPressure, everyone(s));
  return ev;
};
/** Puts three blue champions on the red T1 with the top wave already pushed. */
function push3(round = 1): GameState {
  const s = fresh(round);
  for (const r of ['top', 'jungle', 'mid']) get(s, 'blue', r).position = 'top-t1-red';
  s.waves.top = 1;
  return s;
}

describe('waves', () => {
  test('lone blue laner moves the wave toward red', () => {
    const s = fresh();
    get(s, 'blue', 'top').position = 'top-lane';
    run(s);
    expect(s.waves.top).toBe(1);
  });
  test('even 1v1 moves the wave toward the trade loser', () => {
    const s = fresh();
    get(s, 'blue', 'top').position = 'top-lane';
    get(s, 'red', 'top').position = 'top-lane';
    const ev = run(s, { top: 'blue' });
    expect(s.waves.top).toBe(1);
    expect(ev).toContainEqual({ type: 'wave', lane: 'top', from: 0, to: 1 });
    expect(get(s, 'blue', 'top').bonusLead).toBe(d.rules.economy.tradeLead);
    expect(get(s, 'red', 'top').bonusLead).toBe(0);
  });
  test('empty lane drifts back to the middle', () => {
    const s = fresh();
    Object.assign(s.waves, { mid: -1 });
    run(s);
    expect(s.waves.mid).toBe(0);
  });
});

describe('laners staying in lane without a trade', () => {
  /** Matchup alone decides: strength off, leads zeroed by `fresh`. */
  const matchupOnly = { ...d, rules: { ...d.rules, fight: { ...d.rules.fight, strength: 0 } } };
  const onT1s = (): GameState => {
    const s = fresh();
    get(s, 'blue', 'top').position = 'top-t1-blue';
    get(s, 'red', 'top').position = 'top-t1-red';
    return s;
  };
  test('the positive-matchup laner pushes the wave toward the weaker side', () => {
    const s = onT1s();
    const adv = matchupAdvantage(d, get(s, 'blue', 'top').id, get(s, 'red', 'top').id, roundWindow(d.rules, 1).stage)!;
    expect(adv).toBeGreaterThan(0);
    const ev: GameEvent[] = [];
    updateLanes(s, matchupOnly, {}, ev, new Set(), everyone(s));
    expect(s.waves.top).toBe(1);
    expect(ev).toContainEqual({ type: 'wave', lane: 'top', from: 0, to: 1 });
    expect(get(s, 'blue', 'top').bonusLead).toBe(0);
  });
  test('an exact tie leaves the wave', () => {
    const s = onT1s();
    const neutral = { ...matchupOnly, matchups: [] };
    updateLanes(s, neutral, {}, [], new Set(), everyone(s));
    expect(s.waves.top).toBe(0);
  });
  test('a tied trade this round leaves the wave even if the scores differ', () => {
    const s = onT1s();
    updateLanes(s, matchupOnly, { top: null }, [], new Set(), everyone(s));
    expect(s.waves.top).toBe(0);
  });
});

describe('towers', () => {
  test('3 attackers remove pushDamage[2]; grubs and baron multiply', () => {
    const s = push3();
    const ev = run(s);
    expect(s.towers['top-t1-red']).toBe(3);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'towerDamage', tower: 'top-t1-red', hp: 3, destroyed: false }));
    expect(s.platesTaken.blue).toBe(2);

    const g = push3();
    g.grubs.blue = true;
    run(g);
    expect(g.towers['top-t1-red']).toBe(2);

    const b = push3();
    b.grubs.blue = true;
    b.baronUntilRound.blue = b.round;
    const bev = run(b);
    expect(b.towers['top-t1-red']).toBeLessThanOrEqual(0);
    expect(bev).toContainEqual(expect.objectContaining({ type: 'towerDamage', destroyed: true }));
    expect(b.towersDestroyed.blue).toBe(1);
    expect(frontTower(b, d, 'red', 'top')).toBe('top-t2-red');
  });
  /** Gold a laner pusher earns from farm + passive in `round`: 2 laners share the wave (the jungler takes none). */
  const base = (round: number): number => {
    const sec = roundWindow(d.rules, round).seconds;
    return (d.rules.economy.farmGoldPerMin * sec) / 60 / 2 + (d.rules.economy.passiveGoldPerMin * sec) / 60;
  };
  test('plate gold is split among attackers before 14:00', () => {
    const s = push3(1);
    run(s);
    expect(get(s, 'blue', 'top').goldEarned).toBeCloseTo(base(1) + (d.rules.towers.plateGold * 2) / 3, 6);
    expect(get(s, 'blue', 'top').gold).toBeCloseTo(get(s, 'blue', 'top').goldEarned, 6);
  });
  test('plates give no gold after 14:00', () => {
    const s = push3(41);
    run(s);
    expect(s.platesTaken.blue).toBe(2);
    expect(get(s, 'blue', 'top').goldEarned).toBeCloseTo(base(41), 6);
  });
  test('defender on the tower blocks damage', () => {
    const s = push3();
    get(s, 'red', 'top').position = 'top-t1-red';
    run(s);
    expect(s.towers['top-t1-red']).toBe(5);
  });
});

describe('farming', () => {
  test('adc and support alone in bot for 20s', () => {
    const s = fresh();
    get(s, 'blue', 'adc').position = 'bot-lane';
    get(s, 'blue', 'support').position = 'bot-lane';
    run(s);
    const passive = (d.rules.economy.passiveGoldPerMin * 20) / 60;
    expect(get(s, 'blue', 'adc').gold - passive).toBeCloseTo(110, 6);
    expect(get(s, 'blue', 'support').gold - passive).toBeCloseTo(33, 6);
    expect(get(s, 'blue', 'adc').goldEarned).toBeCloseTo(110 + passive, 6);
    const duoXp = (d.rules.economy.farmXpPerMin * d.rules.economy.duoXpShare * 20) / 60;
    expect(get(s, 'blue', 'adc').xp).toBeCloseTo(duoXp, 6);
    expect(get(s, 'blue', 'support').xp).toBeCloseTo(duoXp, 6);
  });
  test('a support alone in lane gets the support share of a solo laner, not the duo share', () => {
    const s = fresh();
    get(s, 'blue', 'support').position = 'bot-lane';
    get(s, 'red', 'support').position = 'top-lane';
    get(s, 'red', 'top').position = 'top-lane';
    run(s);
    const soloXp = (d.rules.economy.farmXpPerMin * 20) / 60;
    expect(get(s, 'blue', 'support').xp).toBeCloseTo(soloXp * d.rules.economy.supportShare, 6);
    // With a non-bot carry, the support and the carry farm as if no duo.
    expect(get(s, 'red', 'support').xp).toBeCloseTo(soloXp * d.rules.economy.supportShare, 6);
    expect(get(s, 'red', 'top').xp).toBeCloseTo(soloXp, 6);
  });
  test('a jungler in lane takes no wave farm and leaves the laner its full share', () => {
    const s = fresh();
    get(s, 'blue', 'top').position = 'top-lane';
    get(s, 'blue', 'jungle').position = 'top-lane';
    run(s);
    const passive = (d.rules.economy.passiveGoldPerMin * 20) / 60;
    const solo = { gold: (d.rules.economy.farmGoldPerMin * 20) / 60, xp: (d.rules.economy.farmXpPerMin * 20) / 60 };
    expect(get(s, 'blue', 'jungle').gold).toBeCloseTo(passive, 6);
    expect(get(s, 'blue', 'jungle').xp).toBe(0);
    expect(get(s, 'blue', 'top').gold - passive).toBeCloseTo(solo.gold, 6);
    expect(get(s, 'blue', 'top').xp).toBeCloseTo(solo.xp, 6);
  });
  test('under lane pressure the smaller side farms at pressureFarmShare; not in a lane without pressure', () => {
    const farmed = (ganked: Set<Lane>): { gold: number; xp: number } => {
      const s = fresh();
      for (const r of ['adc', 'support']) get(s, 'blue', r).position = 'bot-lane';
      get(s, 'red', 'adc').position = 'bot-lane';
      run(s, {}, ganked);
      const passive = (d.rules.economy.passiveGoldPerMin * 20) / 60;
      return { gold: get(s, 'red', 'adc').gold - passive, xp: get(s, 'red', 'adc').xp };
    };
    const solo = { gold: (d.rules.economy.farmGoldPerMin * 20) / 60, xp: (d.rules.economy.farmXpPerMin * 20) / 60 };
    const share = d.rules.economy.pressureFarmShare;
    const pressured = farmed(new Set());
    expect(pressured.gold).toBeCloseTo(solo.gold * share, 6);
    expect(pressured.xp).toBeCloseTo(solo.xp * share, 6);
    const ganked = farmed(new Set(['bot']));
    expect(ganked.gold).toBeCloseTo(solo.gold, 6);
    expect(ganked.xp).toBeCloseTo(solo.xp, 6);
  });
  test('a solo laner who only farms hits level 6 by 6:55 (round 18), 11 by 14:15 (round 40) and 15 by the end', () => {
    const s = fresh();
    const top = get(s, 'blue', 'top');
    top.position = 'top-lane';
    const levels: Record<number, number> = {};
    for (let r = 1; r <= totalRounds(d.rules); r++) {
      s.round = r;
      s.waves.top = 0;
      run(s);
      levels[r] = level(top.xp, d.rules);
    }
    expect(levels[18]).toBeGreaterThanOrEqual(6);
    expect(levels[40]).toBeGreaterThanOrEqual(11);
    expect(levels[totalRounds(d.rules)]).toBeGreaterThanOrEqual(15);
  });
});

describe('absent laner chip', () => {
  test('pressure over an absent laner chips the front tower once', () => {
    const s = fresh();
    s.waves.top = 1;
    get(s, 'blue', 'top').position = 'top-lane';
    const a = get(s, 'blue', 'top'), r = get(s, 'red', 'top');
    const adv = matchupAdvantage(d, a.id, r.id, roundWindow(d.rules, 1).stage);
    run(s);
    expect(s.towers['top-t1-red']).toBe(adv !== null && adv > 0 ? 5 - d.rules.towers.absentLanerChip : 5);
  });
});

describe('lanePressure', () => {
  test('the side whose laners score higher in a fight on the lane middle, null on a tie or an empty side', () => {
    const s = fresh(10);
    const bt = get(s, 'blue', 'top'), rt = get(s, 'red', 'top');
    bt.position = 'top-t1-blue';
    rt.position = 'top-t1-red';
    expect(lanePressure(s, d, 'mid')).toBeNull();
    bt.bonusLead = 100_000;
    expect(lanePressure(s, d, 'top')).toBe('blue');
    bt.bonusLead = 0;
    rt.bonusLead = 100_000;
    expect(lanePressure(s, d, 'top')).toBe('red');
    rt.position = 'raptors-red';
    expect(lanePressure(s, d, 'top')).toBeNull();
  });

  test('equal counts push the wave away from the pressure side', () => {
    const s = fresh(10);
    get(s, 'blue', 'top').position = 'top-lane';
    get(s, 'red', 'top').position = 'top-lane';
    get(s, 'red', 'top').bonusLead = 100_000;
    s.waves.top = 0;
    expect(lanePressure(s, d, 'top')).toBe('red');
    run(s);
    expect(s.waves.top as number).toBe(-1);
  });
});

describe('Push stance', () => {
  /** Blue and red tops on the lane middle, matchups and strength neutral: no fight-score push. */
  const neutral = { ...d, matchups: [], rules: { ...d.rules, fight: { ...d.rules.fight, strength: 0 } } };
  const even = (): GameState => {
    const s = fresh();
    get(s, 'blue', 'top').position = 'top-lane';
    get(s, 'red', 'top').position = 'top-lane';
    return s;
  };

  test('a side with a Push laner in its lane moves the wave one extra step toward the enemy', () => {
    const s = even();
    updateLanes(s, neutral, {}, [], new Set(), everyone(s));
    expect(s.waves.top).toBe(0);
    const p = even();
    get(p, 'red', 'top').stance = 'push';
    const ev: GameEvent[] = [];
    updateLanes(p, neutral, {}, ev, new Set(), everyone(p));
    expect(p.waves.top).toBe(-1);
    expect(ev).toContainEqual({ type: 'wave', lane: 'top', from: 0, to: -1 });
  });

  test('both sides pushing cancel out; the extra step is clamped', () => {
    const s = even();
    get(s, 'blue', 'top').stance = 'push';
    get(s, 'red', 'top').stance = 'push';
    updateLanes(s, neutral, {}, [], new Set(), everyone(s));
    expect(s.waves.top).toBe(0);

    const lone = fresh();
    get(lone, 'blue', 'top').position = 'top-lane';
    get(lone, 'blue', 'top').stance = 'push';
    lone.waves.top = -1;
    run(lone);
    expect(lone.waves.top as number).toBe(1);
    run(lone);
    expect(lone.waves.top as number).toBe(1);
  });

  test('a Push laner on the pushed tower adds rules.lanes.pushBonus to the tower damage', () => {
    const s = fresh();
    get(s, 'blue', 'top').position = 'top-t1-red';
    s.waves.top = 1;
    run(s);
    const plain = d.rules.towers.hp - s.towers['top-t1-red']!;
    const p = fresh();
    get(p, 'blue', 'top').position = 'top-t1-red';
    get(p, 'blue', 'top').stance = 'push';
    p.waves.top = 1;
    run(p);
    expect(d.rules.lanes.pushBonus).toBeGreaterThan(0);
    expect(d.rules.towers.hp - p.towers['top-t1-red']!).toBeCloseTo(plain + d.rules.lanes.pushBonus);
  });

  test('laneExposure: the wave toward the enemy, +1 with a Push laner in the lane', () => {
    const s = fresh();
    get(s, 'blue', 'top').position = 'top-lane';
    s.waves.top = 1;
    expect(laneExposure(s, d, 'blue', 'top')).toBe(1);
    expect(laneExposure(s, d, 'red', 'top')).toBe(-1);
    get(s, 'blue', 'top').stance = 'push';
    expect(laneExposure(s, d, 'blue', 'top')).toBe(2);
    s.waves.top = -1;
    expect(laneExposure(s, d, 'blue', 'top')).toBe(0);
    // A Push laner out of the lane does not expose it.
    get(s, 'blue', 'top').position = 'blue-base';
    expect(laneExposure(s, d, 'blue', 'top')).toBe(-1);
  });
});
