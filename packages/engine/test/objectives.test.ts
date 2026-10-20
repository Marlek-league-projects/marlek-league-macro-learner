import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import type { GameData, Side } from '@lml/data/contracts';
import { captureObjectives, clearCamps, launchHeralds, newGame, roundWindow, spawnObjectives } from '@lml/engine';
import type { ChampionState, GameEvent, GameState, Orders } from '@lml/engine/contracts';

const d = loadGameData();
const get = (s: GameState, side: Side, role: string): ChampionState =>
  s.champions.find((c) => c.side === side && c.role === role)!;
const team = (s: GameState, side: Side): ChampionState[] => s.champions.filter((c) => c.side === side);

function fresh(round: number): GameState {
  const s = newGame(d, 7);
  s.round = round;
  for (const c of s.champions) {
    c.xp = 0; c.items = 0; c.bonusLead = 0; c.gold = 0; c.goldEarned = 0;
    c.position = `base-${c.side}`;
  }
  spawnObjectives(s, d);
  return s;
}
/** Advances to `round` and runs the round-start spawn step. */
function nextRound(s: GameState): void {
  s.round += 1;
  spawnObjectives(s, d);
}
const capture = (s: GameState): GameEvent[] => {
  const ev: GameEvent[] = [];
  captureObjectives(s, d, ev);
  return ev;
};

describe('pit objectives', () => {
  test('a lone jungler starts a dragon capture, then takes it by staying', () => {
    const s = fresh(11);
    expect(s.pits['dragon-pit'].objective).toBe('dragon');
    get(s, 'blue', 'jungle').position = 'dragon-pit';
    let ev = capture(s);
    expect(s.pits['dragon-pit'].capture).toEqual({ side: 'blue', startedRound: 11 });
    expect(s.objectivesTaken.blue.dragon).toBeUndefined();
    expect(ev.map((e) => e.type)).toEqual(['objectiveStarted']);

    nextRound(s);
    ev = capture(s);
    expect(s.objectivesTaken.blue.dragon).toBe(1);
    for (const c of team(s, 'blue')) expect(c.bonusLead).toBe(d.rules.buffs.dragonLead);
    for (const c of team(s, 'red')) expect(c.bonusLead).toBe(0);
    const jg = get(s, 'blue', 'jungle');
    expect(jg.gold).toBe(d.rules.objectives.dragon.gold);
    expect(jg.goldEarned).toBe(d.rules.objectives.dragon.gold);
    expect(jg.xp).toBe(d.rules.objectives.dragon.xp);
    expect(ev).toContainEqual({ type: 'objectiveTaken', objective: 'dragon', side: 'blue', position: 'dragon-pit', champions: [jg.id] });
    expect(s.pits['dragon-pit']).toEqual({
      objective: null,
      nextSpawn: roundWindow(d.rules, 12).end + d.rules.objectives.dragon.respawn!,
      capture: null,
    });
  });

  test('red arriving while blue flees resets the capture', () => {
    const s = fresh(11);
    get(s, 'blue', 'jungle').position = 'dragon-pit';
    capture(s);
    nextRound(s);
    get(s, 'blue', 'jungle').position = 'redbuff-blue';
    get(s, 'red', 'jungle').position = 'dragon-pit';
    capture(s);
    // red's arrival starts its own capture; blue's is gone and no dragon is taken
    expect(s.pits['dragon-pit'].capture).toEqual({ side: 'red', startedRound: 12 });
    expect(s.objectivesTaken.blue.dragon).toBeUndefined();
    expect(s.objectivesTaken.red.dragon).toBeUndefined();
    expect(s.pits['dragon-pit'].objective).toBe('dragon');
  });

  test('both sides present resets the capture', () => {
    const s = fresh(11);
    get(s, 'blue', 'jungle').position = 'dragon-pit';
    capture(s);
    nextRound(s);
    get(s, 'red', 'jungle').position = 'dragon-pit';
    capture(s);
    expect(s.pits['dragon-pit'].capture).toBeNull();
    expect(s.pits['dragon-pit'].objective).toBe('dragon');
  });

  test('4 champions take the dragon on arrival', () => {
    const s = fresh(11);
    for (const r of ['jungle', 'mid', 'adc', 'support']) get(s, 'blue', r).position = 'dragon-pit';
    capture(s);
    expect(s.objectivesTaken.blue.dragon).toBe(1);
    expect(get(s, 'blue', 'mid').gold).toBe(d.rules.objectives.dragon.gold / 4);
  });

  test('5 champions on Baron still need the extra round', () => {
    const s = fresh(33);
    expect(s.pits['baron-pit'].objective).toBe('baron');
    for (const c of team(s, 'blue')) c.position = 'baron-pit';
    capture(s);
    expect(s.objectivesTaken.blue.baron).toBeUndefined();
    expect(s.pits['baron-pit'].capture).toEqual({ side: 'blue', startedRound: 33 });
    nextRound(s);
    capture(s);
    expect(s.objectivesTaken.blue.baron).toBe(1);
    expect(s.baronUntilRound.blue).toBe(34 + d.rules.buffs.baronRounds - 1);
    expect(s.pits['baron-pit'].nextSpawn).toBe(roundWindow(d.rules, 34).end + d.rules.objectives.baron.respawn!);
  });

  test('Baron needs 3 champions: 2 never start a capture', () => {
    const s = fresh(33);
    get(s, 'blue', 'jungle').position = 'baron-pit';
    get(s, 'blue', 'mid').position = 'baron-pit';
    capture(s);
    expect(s.pits['baron-pit'].capture).toBeNull();
    nextRound(s);
    capture(s);
    expect(s.pits['baron-pit'].capture).toBeNull();
    expect(s.objectivesTaken.blue.baron).toBeUndefined();
  });

  test('voidgrubs give the grubs buff', () => {
    const s = fresh(16);
    expect(s.pits['baron-pit'].objective).toBe('voidgrubs');
    for (const r of ['top', 'jungle', 'mid', 'support']) get(s, 'red', r).position = 'baron-pit';
    capture(s);
    expect(s.grubs.red).toBe(true);
    expect(s.objectivesTaken.red.voidgrubs).toBe(1);
  });

  test('at 840 s the voidgrubs are replaced by the Herald', () => {
    const s = fresh(25);
    expect(roundWindow(d.rules, 25).end).toBeLessThan(840);
    expect(s.pits['baron-pit'].objective).toBe('voidgrubs');
    get(s, 'blue', 'jungle').position = 'baron-pit';
    capture(s);
    nextRound(s); // round 26 ends at 850
    expect(s.pits['baron-pit'].objective).toBe('herald');
    expect(s.pits['baron-pit'].capture).toBeNull();
  });

  test('voidgrubs taken earlier do not respawn; the Herald comes at 840 s', () => {
    const s = fresh(16);
    for (const r of ['top', 'jungle', 'mid', 'support']) get(s, 'blue', r).position = 'baron-pit';
    capture(s);
    for (const c of s.champions) c.position = `base-${c.side}`;
    for (let r = 17; r <= 25; r++) {
      nextRound(s);
      expect(s.pits['baron-pit'].objective).toBeNull();
    }
    nextRound(s);
    expect(s.pits['baron-pit'].objective).toBe('herald');
  });

  test('Herald goes to the taker with the highest lead', () => {
    const s = fresh(27);
    expect(s.pits['baron-pit'].objective).toBe('herald');
    const takers = ['top', 'jungle', 'mid', 'adc'].map((r) => get(s, 'blue', r));
    for (const c of takers) c.position = 'baron-pit';
    get(s, 'blue', 'mid').bonusLead = 500;
    capture(s);
    expect(s.objectivesTaken.blue.herald).toBe(1);
    for (const c of takers) expect(c.hasHerald).toBe(c.role === 'mid');
  });

  test('a pit objective is not taken before it spawns', () => {
    const s = fresh(10);
    expect(s.pits['dragon-pit'].objective).toBeNull();
    for (const c of team(s, 'blue')) c.position = 'dragon-pit';
    capture(s);
    expect(s.objectivesTaken.blue.dragon).toBeUndefined();
    expect(s.pits['dragon-pit'].capture).toBeNull();
  });
});

describe('scuttles', () => {
  test('scuttle is taken on arrival and grants a pit ward', () => {
    const s = fresh(7);
    const jg = get(s, 'red', 'jungle');
    jg.position = 'scuttle-bot';
    const ev = capture(s);
    expect(jg.gold).toBe(d.rules.objectives.scuttle.gold);
    expect(s.objectivesTaken.red.scuttle).toBe(1);
    expect(s.wards).toEqual([{ side: 'red', position: 'dragon-pit', placedRound: 7, scuttle: true }]);
    expect(s.scuttles['scuttle-bot']).toBe(roundWindow(d.rules, 7).end + d.rules.objectives.scuttle.respawn!);
    expect(ev).toContainEqual({ type: 'objectiveTaken', objective: 'scuttle', side: 'red', position: 'scuttle-bot', champions: [jg.id] });
  });

  test('scuttle is not taken before it spawns', () => {
    const s = fresh(5);
    get(s, 'blue', 'jungle').position = 'scuttle-top';
    capture(s);
    expect(s.objectivesTaken.blue.scuttle).toBeUndefined();
    expect(s.wards).toEqual([]);
  });
});

describe('camps', () => {
  const clear = (s: GameState, via: Record<string, string | undefined>, data = d): GameEvent[] => {
    const ev: GameEvent[] = [];
    clearCamps(s, data, via, ev);
    return ev;
  };

  /** Game data where `id` has the given clearSpeed (the shared data is left untouched). */
  const withClearSpeed = (id: string, clearSpeed: number): GameData =>
    ({ ...d, champions: { ...d.champions, [id]: { ...d.champions[id]!, clearSpeed } } });

  test('fast jungler clears the via camp and the arrival camp', () => {
    const s = fresh(2);
    const jg = get(s, 'blue', 'jungle');
    jg.position = 'krugs-blue';
    const ev = clear(s, { [jg.id]: 'redbuff-blue' }, withClearSpeed(jg.id, 8));
    expect(ev).toEqual([
      { type: 'campCleared', camp: 'redbuff-blue', champion: jg.id },
      { type: 'campCleared', camp: 'krugs-blue', champion: jg.id },
    ]);
    const end = roundWindow(d.rules, 2).end;
    expect(s.camps['redbuff-blue']).toBe(end + d.rules.camps.buffRespawn);
    expect(s.camps['krugs-blue']).toBe(end + d.rules.camps.smallRespawn);
    expect(jg.gold).toBe(d.rules.camps.buffGold + d.rules.camps.smallGold);
    expect(jg.xp).toBe(d.rules.camps.buffXp + d.rules.camps.smallXp);
  });

  test('slow jungler clears only the arrival camp', () => {
    const s = fresh(2);
    const jg = get(s, 'blue', 'jungle');
    jg.position = 'krugs-blue';
    const ev = clear(s, { [jg.id]: 'redbuff-blue' }, withClearSpeed(jg.id, 5));
    expect(ev).toEqual([{ type: 'campCleared', camp: 'krugs-blue', champion: jg.id }]);
    expect(s.camps['redbuff-blue']).toBe(d.rules.camps.firstSpawn);
  });

  test('a camp that has not respawned is not cleared again', () => {
    const s = fresh(2);
    const jg = get(s, 'blue', 'jungle');
    jg.position = 'gromp-blue';
    clear(s, {});
    s.round = 3;
    const ev = clear(s, {});
    expect(ev).toEqual([]);
    expect(jg.gold).toBe(d.rules.camps.smallGold);
  });

  test('a laner on an enemy camp clears it too', () => {
    const s = fresh(2);
    const mid = get(s, 'red', 'mid');
    mid.position = 'raptors-blue';
    const ev = clear(s, {});
    expect(ev).toEqual([{ type: 'campCleared', camp: 'raptors-blue', champion: mid.id }]);
  });
});

describe('herald launch', () => {
  const launch = (s: GameState, c: ChampionState): GameEvent[] => {
    const orders: Orders = { blue: [], red: [] };
    orders[c.side].push({ kind: 'move', champion: c.id, to: c.position, launchHerald: true });
    const ev: GameEvent[] = [];
    launchHeralds(s, d, orders, ev);
    return ev;
  };

  test('an alive carrier on an enemy tower deals heraldDamage', () => {
    const s = fresh(28);
    const c = get(s, 'blue', 'top');
    c.hasHerald = true;
    c.position = 'top-t1-red';
    const ev = launch(s, c);
    const hp = d.rules.towers.hp - d.rules.towers.heraldDamage;
    expect(s.towers['top-t1-red']).toBe(hp);
    expect(c.hasHerald).toBe(false);
    expect(ev).toEqual([
      { type: 'towerDamage', tower: 'top-t1-red', side: 'red', damage: d.rules.towers.heraldDamage, hp, destroyed: false },
      { type: 'heraldLaunched', tower: 'top-t1-red', side: 'red' },
    ]);
  });

  test('a carrier killed in the launch round deals no damage and loses the Herald', () => {
    const s = fresh(28);
    const c = get(s, 'blue', 'top');
    c.hasHerald = true;
    c.position = 'top-t1-red';
    c.status = 'dead';
    const ev = launch(s, c);
    expect(s.towers['top-t1-red']).toBe(d.rules.towers.hp);
    expect(c.hasHerald).toBe(false);
    expect(ev).toEqual([]);
  });

  test('a launch away from an enemy tower keeps the Herald', () => {
    const s = fresh(28);
    const c = get(s, 'blue', 'top');
    c.hasHerald = true;
    c.position = 'top-lane';
    expect(launch(s, c)).toEqual([]);
    expect(c.hasHerald).toBe(true);
  });
});
