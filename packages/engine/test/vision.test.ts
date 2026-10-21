import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { defaultOrders, eventsFor, lanePressure, newGame, resolveRound, route, viewFor, visibleEnemies, wardRoundsLeft } from '@lml/engine';
import type { ChampionState, GameState, Order, Orders } from '@lml/engine/contracts';

const d = loadGameData();
const get = (s: GameState, side: string, role: string): ChampionState =>
  s.champions.find((c) => c.side === side && c.role === role)!;
const place = (s: GameState, side: string, role: string, pos: string): void => {
  const c = get(s, side, role);
  c.position = pos;
  c.previous = pos;
};
const ordersWith = (s: GameState, over: Order[] = []): Orders => {
  const f = (side: 'blue' | 'red'): Order[] =>
    defaultOrders(s, d, side).map((o) => over.find((x) => x.champion === o.champion) ?? o);
  return { blue: f('blue'), red: f('red') };
};

describe('visibleEnemies', () => {
  test('an enemy anywhere in the lane of an ally is visible', () => {
    const s = newGame(d, 5);
    place(s, 'red', 'top', 'top-t2-red');
    place(s, 'red', 'jungle', 'gromp-red');
    const seen = visibleEnemies(s, d, 'blue');
    expect(seen).toContain(get(s, 'red', 'top').id);
    expect(seen).not.toContain(get(s, 'red', 'jungle').id);
  });

  test('a ward placed in round 3 reveals in rounds 4 and 5, then is gone', () => {
    const s = newGame(d, 5);
    s.round = 3;
    place(s, 'blue', 'jungle', 'raptors-red');
    place(s, 'red', 'jungle', 'gromp-red');
    const bj = get(s, 'blue', 'jungle').id;
    const rj = get(s, 'red', 'jungle').id;
    const r3 = resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: bj, to: 'redbuff-red', ward: 'from' }]), {});
    const ward = { side: 'blue' as const, position: 'raptors-red', placedRound: 3 };
    expect(r3.state.wards).toContainEqual(ward);
    expect(wardRoundsLeft(ward, 4, d.rules)).toBe(2);

    const s4 = r3.state;
    place(s4, 'red', 'jungle', 'raptors-red');
    expect(visibleEnemies(s4, d, 'blue')).toContain(rj);
    const r4 = resolveRound(s4, d, ordersWith(s4), {});
    expect(r4.state.lastSeen.blue[rj]).toEqual({ position: 'raptors-red', round: 4 });
    expect(r4.state.wards).toContainEqual(ward);
    expect(wardRoundsLeft(ward, 5, d.rules)).toBe(1);

    const s5 = r4.state;
    expect(visibleEnemies(s5, d, 'blue')).toContain(rj);
    const r5 = resolveRound(s5, d, ordersWith(s5), {});
    expect(r5.state.lastSeen.blue[rj]).toEqual({ position: 'raptors-red', round: 5 });
    expect(r5.state.wards.some((w) => w.position === 'raptors-red')).toBe(false);
    expect(wardRoundsLeft(ward, 6, d.rules)).toBe(0);

    expect(visibleEnemies(r5.state, d, 'blue')).not.toContain(rj);
    const r6 = resolveRound(r5.state, d, ordersWith(r5.state), {});
    expect(r6.state.lastSeen.blue[rj]).toEqual({ position: 'raptors-red', round: 5 });
    expect(viewFor(r6.state, d, 'blue').enemies.find((e) => e.id === rj)).toMatchObject({
      visible: false, position: 'raptors-red', lastSeenRound: 5, level: null,
    });
  });

  test('a ward being ordered shows its full duration', () => {
    expect(wardRoundsLeft({ side: 'blue', position: 'raptors-red', placedRound: 3 }, 3, d.rules)).toBe(2);
  });
});

describe('viewFor', () => {
  test('only enemies visible this round show their current position', () => {
    const s = newGame(d, 9);
    s.round = 4;
    place(s, 'red', 'top', 'top-t2-red');
    place(s, 'red', 'mid', 'wolves-red');
    place(s, 'red', 'jungle', 'raptors-red');
    s.lastSeen.blue[get(s, 'red', 'mid').id] = { position: 'mid-t1-red', round: 2 };
    s.wards.push({ side: 'blue', position: 'raptors-red', placedRound: 3 });
    s.wards.push({ side: 'red', position: 'raptors-blue', placedRound: 3 });
    const after = resolveRound(s, d, ordersWith(s), {}).state;
    const seen = Object.entries(after.lastSeen.blue).filter(([, v]) => v?.round === 4).map(([id]) => id);
    expect(seen).toHaveLength(4);
    const view = viewFor(after, d, 'blue');
    expect(view.side).toBe('blue');
    expect(view.round).toBe(5);
    expect(view.allies.map((c) => c.side)).toEqual(['blue', 'blue', 'blue', 'blue', 'blue']);
    expect(view.enemies).toHaveLength(5);
    for (const e of view.enemies) {
      const real = after.champions.find((c) => c.id === e.id)!;
      if (seen.includes(e.id)) {
        expect(e).toMatchObject({ visible: true, position: real.position, lastSeenRound: 4 });
        expect(e.level).not.toBeNull();
      } else {
        const last = after.lastSeen.blue[e.id] ?? null;
        expect(e).toMatchObject({ visible: false, position: last?.position ?? null, level: null });
      }
    }
    const mid = view.enemies.find((e) => e.id === get(s, 'red', 'mid').id)!;
    expect(mid).toMatchObject({ visible: false, position: 'mid-t1-red', lastSeenRound: 2 });
    expect(view.wards.every((w) => w.side === 'blue')).toBe(true);
    expect(view.camps).toEqual(after.campsSeen.blue);
  });

  test('round 1 shows the enemy jungler start camp', () => {
    const s = newGame(d, 9);
    const rj = get(s, 'red', 'jungle');
    const e = viewFor(s, d, 'blue').enemies.find((x) => x.id === rj.id)!;
    expect(e).toMatchObject({ visible: true, position: rj.position });
    const laner = viewFor(s, d, 'blue').enemies.find((x) => x.id === get(s, 'red', 'top').id)!;
    expect(laner).toMatchObject({ visible: false, position: null });
  });
});

describe('fog of war on objectives', () => {
  test('an enemy pit capture is hidden unless an enemy is seen on the pit', () => {
    const run = (ward: boolean): GameState => {
      const s = newGame(d, 5);
      s.round = 12;
      place(s, 'red', 'jungle', 'dragon-pit');
      if (ward) s.wards.push({ side: 'blue', position: 'dragon-pit', placedRound: 11 });
      return resolveRound(s, d, ordersWith(s), {}).state;
    };
    const unseen = run(false);
    expect(unseen.pits['dragon-pit'].capture).toEqual({ side: 'red', startedRound: 12 });
    expect(viewFor(unseen, d, 'blue').pits['dragon-pit'].capture).toBeNull();
    expect(viewFor(unseen, d, 'red').pits['dragon-pit'].capture).toEqual({ side: 'red', startedRound: 12 });
    expect(unseen.pits['dragon-pit'].capture).not.toBeNull(); // the view does not touch the state
    expect(viewFor(run(true), d, 'blue').pits['dragon-pit'].capture).toEqual({ side: 'red', startedRound: 12 });
  });

  test('an unseen enemy scuttle take leaves the scuttle shown as before', () => {
    const run = (ward: boolean): GameState => runScuttle(ward).state;
    const taken = d.rules.objectives.scuttle.respawn! + 230;
    const unseen = run(false);
    expect(unseen.scuttles['scuttle-top']).toBe(taken);
    expect(viewFor(unseen, d, 'blue').scuttles['scuttle-top']).toBe(210);
    expect(viewFor(unseen, d, 'red').scuttles['scuttle-top']).toBe(taken);
    expect(viewFor(run(true), d, 'blue').scuttles['scuttle-top']).toBe(taken);
  });

  test('an enemy scuttle take is announced only where seen; epic objectives always', () => {
    const scuttleTaken = (ward: boolean, side: 'blue' | 'red'): boolean => {
      const { state, events } = runScuttle(ward);
      expect(events.some((e) => e.type === 'objectiveTaken' && e.objective === 'scuttle')).toBe(true);
      return eventsFor(events, state, d, side).some((e) => e.type === 'objectiveTaken' && e.objective === 'scuttle');
    };
    expect(scuttleTaken(false, 'blue')).toBe(false);
    expect(scuttleTaken(false, 'red')).toBe(true);
    expect(scuttleTaken(true, 'blue')).toBe(true);

    const s = newGame(d, 5);
    s.round = 13;
    place(s, 'red', 'jungle', 'dragon-pit');
    s.pits['dragon-pit'] = { objective: 'dragon', nextSpawn: null, capture: { side: 'red', startedRound: 12 } };
    const { state, events } = resolveRound(s, d, ordersWith(s), {});
    expect(events.some((e) => e.type === 'objectiveTaken' && e.objective === 'dragon')).toBe(true);
    expect(eventsFor(events, state, d, 'blue').some((e) => e.type === 'objectiveTaken' && e.objective === 'dragon')).toBe(true);
  });
});

describe('fog of war on own camps', () => {
  /** Red jungler invades blue raptors in round 7; blue watches it with a champion there or a ward, or not at all. */
  const invade = (watch: 'none' | 'champion' | 'ward'): GameState => {
    const s = newGame(d, 5);
    s.round = 7;
    place(s, 'red', 'jungle', 'scuttle-bot');
    place(s, 'blue', 'jungle', 'gromp-blue');
    if (watch === 'champion') place(s, 'blue', 'jungle', 'raptors-blue');
    if (watch === 'ward') s.wards.push({ side: 'blue', position: 'raptors-blue', placedRound: 6 });
    const rj = get(s, 'red', 'jungle').id;
    const bj = get(s, 'blue', 'jungle').id;
    const stay: Order[] = watch === 'champion' ? [{ kind: 'move', champion: bj, to: 'raptors-blue' }] : [];
    return resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: rj, to: 'raptors-blue' }, ...stay]), {}).state;
  };

  test('an unseen enemy invade leaves the own camp shown alive as before', () => {
    const s = invade('none');
    expect(s.camps['raptors-blue']).toBeGreaterThan(d.rules.camps.firstSpawn);
    expect(viewFor(s, d, 'blue').camps['raptors-blue']).toBe(d.rules.camps.firstSpawn);
  });

  test('an own champion or an own ward on the camp updates its timer', () => {
    for (const watch of ['champion', 'ward'] as const) {
      const s = invade(watch);
      expect(viewFor(s, d, 'blue').camps['raptors-blue']).toBe(s.camps['raptors-blue']!);
      expect(viewFor(s, d, 'blue').camps['raptors-blue']).toBeGreaterThan(d.rules.camps.firstSpawn);
    }
  });

  test('a camp the side clears itself shows its respawn timer', () => {
    const s = newGame(d, 5);
    s.round = 7;
    place(s, 'blue', 'jungle', 'redbuff-blue');
    const { state } = resolveRound(s, d, ordersWith(s), {});
    const view = viewFor(state, d, 'blue');
    expect(view.camps['redbuff-blue']).toBe(state.camps['redbuff-blue']!);
    expect(view.camps['redbuff-blue']).toBeGreaterThan(d.rules.camps.firstSpawn);
  });
});

describe('enemy camp timers', () => {
  test('the clearer sees an enemy camp timer, the owner without vision does not', () => {
    const s = newGame(d, 5);
    s.round = 7;
    place(s, 'blue', 'jungle', 'raptors-red');
    place(s, 'red', 'jungle', 'gromp-red');
    const { state, events } = resolveRound(s, d, ordersWith(s), {});
    expect(events).toContainEqual({ type: 'campCleared', camp: 'raptors-red', champion: get(s, 'blue', 'jungle').id });
    expect(state.camps['raptors-red']).toBeGreaterThan(d.rules.camps.firstSpawn);
    expect(viewFor(state, d, 'blue').camps['raptors-red']).toBe(state.camps['raptors-red']!);
    expect(viewFor(state, d, 'red').camps['raptors-red']).toBe(d.rules.camps.firstSpawn);
  });
});

describe('scuttle ward', () => {
  /** Blue jungler takes the bot Scuttle in round 7 while three blue laners place order wards. */
  const takeWithWards = (): ReturnType<typeof resolveRound> => {
    const s = newGame(d, 5);
    s.round = 7;
    place(s, 'blue', 'jungle', 'scuttle-bot');
    const wardFrom = (role: string): Order => ({ kind: 'move', champion: get(s, 'blue', role).id, to: get(s, 'blue', role).position, ward: 'from' });
    return resolveRound(s, d, ordersWith(s, [wardFrom('top'), wardFrom('mid'), wardFrom('adc')]), {});
  };

  test('comes on top of the 3 order wards of the round', () => {
    const { state, events } = takeWithWards();
    expect(events.filter((e) => e.type === 'wardPlaced' && e.side === 'blue')).toHaveLength(3);
    const blue = state.wards.filter((w) => w.side === 'blue');
    expect(blue).toHaveLength(4);
    expect(blue).toContainEqual({ side: 'blue', position: 'scuttle-bot', placedRound: 7, scuttle: true });
  });

  test('shows on the scuttle position in the view, for its side only', () => {
    const { state } = takeWithWards();
    expect(viewFor(state, d, 'blue').wards).toContainEqual({ side: 'blue', position: 'scuttle-bot', placedRound: 7, scuttle: true });
    expect(viewFor(state, d, 'red').wards).toEqual([]);
  });

  test('reveals its pit for the next 2 rounds', () => {
    const s = takeWithWards().state;
    place(s, 'blue', 'jungle', 'redbuff-blue');
    place(s, 'red', 'jungle', 'dragon-pit');
    const rj = get(s, 'red', 'jungle').id;
    expect(visibleEnemies(s, d, 'blue')).toContain(rj);
    s.round = 9;
    expect(visibleEnemies(s, d, 'blue')).toContain(rj);
    s.round = 10;
    expect(visibleEnemies(s, d, 'blue')).not.toContain(rj);
  });
});

describe('ward spotting', () => {
  /** Every alive champion stays put, then overrides by champion id. */
  const stayWith = (s: GameState, over: Order[]): Orders => {
    const f = (side: 'blue' | 'red'): Order[] =>
      s.champions
        .filter((c) => c.side === side && c.status === 'alive')
        .map((c) => over.find((x) => x.champion === c.id) ?? { kind: 'move', champion: c.id, to: c.position });
    return { blue: f('blue'), red: f('red') };
  };
  /** Round 15 (budget 3): red jungler walks from raptors-red to `to` past a blue ward on scuttle-top. */
  const walk = (to: string, extraWard?: string): { s: GameState; r: ReturnType<typeof resolveRound>; rj: string } => {
    const s = newGame(d, 5);
    s.round = 15;
    place(s, 'red', 'jungle', 'raptors-red');
    s.wards.push({ side: 'blue', position: 'scuttle-top', placedRound: 14 });
    if (extraWard) s.wards.push({ side: 'blue', position: extraWard, placedRound: 14 });
    const rj = get(s, 'red', 'jungle').id;
    expect(route(d, 'raptors-red', to, 'red')).toContain('scuttle-top');
    return { s, r: resolveRound(s, d, stayWith(s, [{ kind: 'move', champion: rj, to }]), {}), rj };
  };

  test('an enemy walking through a warded Scuttle is spotted, with its arrival when seen', () => {
    const { r, rj } = walk('bluebuff-blue', 'bluebuff-blue');
    expect(r.events).toContainEqual({ type: 'wardSpotted', side: 'blue', position: 'scuttle-top', champion: rj, to: 'bluebuff-blue' });
    expect(r.state.lastSeen.blue[rj]).toEqual({ position: 'bluebuff-blue', round: 15 });
    expect(viewFor(r.state, d, 'blue').enemies.find((e) => e.id === rj)).toMatchObject({ visible: true, position: 'bluebuff-blue' });
  });

  test('an unseen arrival gives a null `to`, and the last warded position as last seen', () => {
    const { r, rj } = walk('gromp-blue');
    const spotted = r.events.filter((e) => e.type === 'wardSpotted');
    expect(spotted).toEqual([{ type: 'wardSpotted', side: 'blue', position: 'scuttle-top', champion: rj, to: null }]);
    expect(r.state.lastSeen.blue[rj]).toMatchObject({ position: 'scuttle-top', round: 15 });
    const e = viewFor(r.state, d, 'blue').enemies.find((x) => x.id === rj)!;
    expect(e).toMatchObject({ visible: false, position: 'scuttle-top', lastSeenRound: 15, level: null, hp: null });
  });

  test('only the ward side sees the event, and it does not reveal the enemy move', () => {
    const { r, rj } = walk('gromp-blue');
    const blue = eventsFor(r.events, r.state, d, 'blue');
    expect(blue.some((e) => e.type === 'wardSpotted')).toBe(true);
    expect(blue.some((e) => e.type === 'moved' && e.champion === rj)).toBe(false);
    expect(eventsFor(r.events, r.state, d, 'red').some((e) => e.type === 'wardSpotted')).toBe(false);
  });

  test('an enemy leaving a warded camp is spotted', () => {
    const s = newGame(d, 5);
    s.round = 15;
    place(s, 'red', 'jungle', 'raptors-red');
    s.wards.push({ side: 'blue', position: 'raptors-red', placedRound: 13 });
    const rj = get(s, 'red', 'jungle').id;
    const r = resolveRound(s, d, stayWith(s, [{ kind: 'move', champion: rj, to: 'redbuff-red' }]), {});
    expect(r.events).toContainEqual({ type: 'wardSpotted', side: 'blue', position: 'raptors-red', champion: rj, to: null });
    expect(r.state.lastSeen.blue[rj]).toMatchObject({ position: 'raptors-red', round: 15 });
  });

  test('a champion staying on a warded position, or an own champion, is not spotted', () => {
    const s = newGame(d, 5);
    s.round = 15;
    place(s, 'red', 'jungle', 'raptors-red');
    place(s, 'blue', 'jungle', 'raptors-blue');
    s.wards.push({ side: 'blue', position: 'raptors-red', placedRound: 14 });
    s.wards.push({ side: 'blue', position: 'raptors-blue', placedRound: 14 });
    const bj = get(s, 'blue', 'jungle').id;
    const r = resolveRound(s, d, stayWith(s, [{ kind: 'move', champion: bj, to: 'redbuff-blue' }]), {});
    expect(r.events.some((e) => e.type === 'wardSpotted')).toBe(false);
  });

  test('an enemy pulled into a lane fight is spotted once per ward, with its arrival position as `to`', () => {
    // Round 1 (budget 2): the red jungler arrives on a warded top-t1-red, then is pulled to the top-lane skirmish.
    const s = newGame(d, 5);
    s.round = 1;
    place(s, 'blue', 'top', 'top-lane');
    place(s, 'blue', 'jungle', 'top-lane');
    place(s, 'red', 'top', 'top-lane');
    place(s, 'red', 'jungle', 'krugs-red');
    get(s, 'red', 'jungle').bonusLead += 100_000;
    get(s, 'red', 'top').bonusLead += 100_000;
    s.wards.push({ side: 'blue', position: 'top-t1-red', placedRound: 0 });
    const rj = get(s, 'red', 'jungle').id;
    const r = resolveRound(s, d, stayWith(s, [{ kind: 'move', champion: rj, to: 'top-t1-red' }]), { 'lane-top': { blue: 'fight', red: 'fight' } });
    expect(r.events.filter((e) => e.type === 'moved' && e.champion === rj)).toHaveLength(2);
    expect(r.state.champions.find((c) => c.id === rj)!.position).toBe('top-lane');
    const spotted = r.events.filter((e) => e.type === 'wardSpotted');
    expect(spotted).toEqual([{ type: 'wardSpotted', side: 'blue', position: 'top-t1-red', champion: rj, to: 'top-t1-red' }]);
  });

  test('a scuttle ward taken this round does not spot moves of the same round', () => {
    const s = newGame(d, 5);
    s.round = 7;
    place(s, 'blue', 'jungle', 'scuttle-bot');
    place(s, 'red', 'jungle', 'dragon-pit');
    const rj = get(s, 'red', 'jungle').id;
    const r = resolveRound(s, d, stayWith(s, [{ kind: 'move', champion: rj, to: 'bluebuff-red' }]), {});
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'objectiveTaken', objective: 'scuttle', side: 'blue' }));
    expect(r.events.some((e) => e.type === 'wardSpotted')).toBe(false);
  });
});

function runScuttle(ward: boolean): ReturnType<typeof resolveRound> {
  const s = newGame(d, 5);
  s.round = 7;
  place(s, 'red', 'jungle', 'raptors-red');
  place(s, 'blue', 'jungle', 'gromp-blue');
  if (ward) s.wards.push({ side: 'blue', position: 'scuttle-top', placedRound: 6 });
  const rj = get(s, 'red', 'jungle').id;
  return resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: rj, to: 'scuttle-top' }]), {});
}

describe('eventsFor', () => {
  /** Every alive champion stays put (no wave following), then overrides by champion id. */
  const stayWith = (s: GameState, over: Order[]): Orders => {
    const f = (side: 'blue' | 'red'): Order[] =>
      s.champions
        .filter((c) => c.side === side && c.status === 'alive')
        .map((c) => over.find((x) => x.champion === c.id) ?? { kind: 'move', champion: c.id, to: c.position });
    return { blue: f('blue'), red: f('red') };
  };

  test('keeps enemy moves only when the enemy was seen', () => {
    const s = newGame(d, 5);
    s.round = 4;
    place(s, 'red', 'jungle', 'gromp-red');
    const rj = get(s, 'red', 'jungle').id;
    const rm = get(s, 'red', 'mid').id;
    const bm = get(s, 'blue', 'mid').id;
    const { state, events } = resolveRound(
      s, d,
      stayWith(s, [
        { kind: 'move', champion: rj, to: 'bluebuff-red' },
        { kind: 'move', champion: rm, to: 'mid-lane' },
        { kind: 'move', champion: bm, to: 'wolves-blue' },
      ]),
      {},
    );
    const moved = (side: 'blue' | 'red'): string[] =>
      eventsFor(events, state, d, side).flatMap((e) => (e.type === 'moved' ? [e.champion] : []));
    expect(events.filter((e) => e.type === 'moved')).toHaveLength(3);
    expect(moved('blue')).toEqual([bm]);
    expect(moved('blue')).not.toContain(rj);
    expect(moved('red').sort()).toEqual([rj, rm].sort());
  });

  test('keeps a visible enemy move', () => {
    const s = newGame(d, 5);
    s.round = 4;
    const rm = get(s, 'red', 'mid').id;
    const { state, events } = resolveRound(s, d, ordersWith(s, [{ kind: 'move', champion: rm, to: 'mid-lane' }]), {});
    expect(eventsFor(events, state, d, 'blue')).toContainEqual({ type: 'moved', champion: rm, from: 'mid-t1-red', to: 'mid-lane', acted: true });
  });
});

describe('scoreboard', () => {
  test('shows kills, towers, dragons, barons and the true gold earned per team', () => {
    const s = newGame(d, 5);
    s.kills = { blue: 3, red: 1 };
    s.towersDestroyed = { blue: 2, red: 0 };
    s.objectivesTaken = { blue: { dragon: 2 }, red: { baron: 1, dragon: 1 } };
    get(s, 'red', 'mid').goldEarned = 1234;
    const sum = (side: string): number =>
      s.champions.filter((c) => c.side === side).reduce((t, c) => t + c.goldEarned, 0);
    for (const side of ['blue', 'red'] as const) {
      expect(viewFor(s, d, side).scoreboard).toEqual({
        kills: { blue: 3, red: 1 },
        towersDestroyed: { blue: 2, red: 0 },
        dragons: { blue: 2, red: 1 },
        barons: { blue: 0, red: 1 },
        goldEarned: { blue: sum('blue'), red: sum('red') },
      });
    }
  });
});

describe('lane pressure in the view', () => {
  /** Blue and red tops on top-lane at round 5; blue saw the red top last round unless `seen` is false. */
  function lane(seen = true): { s: GameState; rt: ChampionState } {
    const s = newGame(d, 7);
    s.round = 5;
    place(s, 'blue', 'top', 'top-lane');
    place(s, 'red', 'top', 'top-lane');
    const rt = get(s, 'red', 'top');
    s.lastSeen.blue[rt.id] = { position: 'top-lane', round: seen ? 4 : 3 };
    return { s, rt };
  }

  test('computed from what the side sees: a visible enemy level counts; an unseen enemy laner gives null', () => {
    const { s, rt } = lane();
    rt.xp = d.rules.economy.levelXp[17]!;
    expect(viewFor(s, d, 'blue').pressure.top).toBe('red');
    expect(viewFor(s, d, 'red').pressure.top).toBeNull(); // red has not seen the blue top
    const unseen = lane(false);
    unseen.rt.xp = d.rules.economy.levelXp[17]!;
    expect(viewFor(unseen.s, d, 'blue').pressure.top).toBeNull();
  });

  test("a visible enemy's hidden items and lead do not change the view's pressure", () => {
    const a = lane();
    const b = lane();
    b.rt.items += 100_000;
    b.rt.bonusLead += 100_000;
    expect(viewFor(b.s, d, 'blue').pressure).toEqual(viewFor(a.s, d, 'blue').pressure);
    // The engine's own push still uses the true values.
    expect(lanePressure(b.s, d, 'top')).toBe('red');
  });
});
