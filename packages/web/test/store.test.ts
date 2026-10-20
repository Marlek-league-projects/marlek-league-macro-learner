import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { createEngine } from '@lml/engine';
import { createStore } from '../src/store';

const data = loadGameData();
const engine = createEngine();

function started(seed = 1) {
  const store = createStore(data, engine);
  store.start({ rank: 'gold', teaching: true, seed });
  return store;
}
const blue = (store: ReturnType<typeof started>, role: string) =>
  store.view.value!.allies.find((c) => c.role === role)!;

describe('store', () => {
  test('start shows the orders screen with a fogged view', () => {
    const store = started();
    expect(store.screen.value).toBe('orders');
    const v = store.view.value!;
    expect(v.allies).toHaveLength(5);
    expect(v.enemies).toHaveLength(5);
    expect(v.enemies.every((e) => !e.visible || e.position !== null)).toBe(true);
    expect(v.enemies.filter((e) => e.visible).length).toBeLessThan(5);
  });

  test('selected jungler on redbuff reaches krugs', () => {
    const store = started();
    for (let i = 0; i < 4 && blue(store, 'jungle').position !== 'redbuff-blue'; i++) {
      const j = blue(store, 'jungle');
      store.select(j.id);
      const reach = store.reachableForSelected();
      const [step] = Object.keys(reach).sort(
        (a, b) => data.graph.distance(a, 'redbuff-blue') - data.graph.distance(b, 'redbuff-blue'),
      );
      store.setMove(j.id, step!);
      store.confirmRound();
      store.confirmContacts();
      store.next();
    }
    const after = blue(store, 'jungle');
    expect(after.position).toBe('redbuff-blue');
    store.select(after.id);
    expect(store.reachableForSelected()['krugs-blue']).toBeDefined();
  });

  test('unreachable move throws /reach/', () => {
    const store = started();
    expect(() => store.setMove(blue(store, 'top').id, 'base-blue')).toThrow(/reach/);
    expect(() => store.setMove(blue(store, 'top').id, 'baron-pit')).toThrow(/reach/);
  });

  test('a 2-step move gets a via on a shortest path', () => {
    const store = started();
    const top = blue(store, 'jungle');
    store.select(top.id);
    const two = Object.entries(store.reachableForSelected()).find(([, d]) => d === 2)![0];
    store.setMove(top.id, two);
    const order = store.pending.value[top.id]!;
    expect(order.kind === 'move' && order.via).toBeTruthy();
    const via = (order as { via: string }).via;
    expect(data.graph.distance(top.position, via) + data.graph.distance(via, two)).toBe(2);
  });

  test('a fast clearer routes via an own camp that is up by the end of the round, like the engine', () => {
    const store = started(5); // Kindred (fast clearer) starts on redbuff-blue
    const play = (): void => {
      store.confirmRound();
      store.confirmContacts();
      store.next();
    };
    const j = blue(store, 'jungle');
    expect([j.position, (data.champions[j.id]?.clearSpeed ?? 0) >= data.rules.camps.fastClearAt]).toEqual(['redbuff-blue', true]);
    play(); // round 1 clears redbuff, back at 110 + buffRespawn = 410
    store.setMove(j.id, 'raptors-blue');
    play();
    while (store.view.value!.round < 15) {
      // The enemy jungler may kill the idle one meanwhile: respawn on raptors again.
      if (blue(store, 'jungle').status === 'respawning') store.setSpawn(j.id, 'raptors-blue');
      play();
    }
    expect(blue(store, 'jungle').position).toBe('raptors-blue');
    const w = store.roundWindow();
    const back = store.view.value!.camps['redbuff-blue']!;
    expect(back > w.start && back <= w.end).toBe(true);
    store.setMove(j.id, 'bot-t1-blue'); // via mid-t1-blue or redbuff-blue
    expect(store.pending.value[j.id]).toMatchObject({ kind: 'move', to: 'bot-t1-blue', via: 'redbuff-blue' });
  });

  test('fourth ward throws /wards/', () => {
    const store = started();
    const ids = store.view.value!.allies.map((c) => c.id);
    const per = data.rules.wards.perRound;
    for (const id of ids.slice(0, per)) store.setWard(id, 'from');
    expect(() => store.setWard(ids[per]!, 'from')).toThrow(/wards/);
    store.setWard(ids[0]!, null);
    store.setWard(ids[per]!, 'from');
  });

  test('respawning champion: move throws /spawn/, setSpawn accepts a spawn point', () => {
    const store = started();
    // a recall makes the top respawn next round, whatever the AI does
    store.setRecall(blue(store, 'top').id);
    // play until a blue champion respawns
    for (let i = 0; i < 37 && store.screen.value !== 'over'; i++) {
      const dead = store.view.value!.allies.find((c) => c.status === 'respawning');
      if (dead) {
        expect(() => store.setMove(dead.id, dead.position)).toThrow(/spawn/);
        expect(() => store.setSpawn(dead.id, 'baron-pit')).toThrow(/spawn/);
        const lane = dead.role === 'top' || dead.role === 'mid' ? dead.role : 'bot';
        const candidates = dead.role === 'jungle'
          ? Object.values(data.graph.positions).filter((p) => p.kind === 'camp' && p.side === 'blue').map((p) => p.id)
          : [...data.graph.towers('blue', lane), 'base-blue'];
        const accepted = candidates.filter((to) => {
          try { store.setSpawn(dead.id, to); return true; } catch { return false; }
        });
        expect(accepted.length).toBeGreaterThan(0);
        return;
      }
      store.confirmRound();
      store.confirmContacts();
      store.next();
    }
    throw new Error('no blue champion ever respawned for this seed');
  });

  test('37 rounds reach over with a winner', () => {
    const store = started(7);
    for (let i = 0; i < 37; i++) {
      store.confirmRound();
      store.confirmContacts();
      store.next();
    }
    expect(store.screen.value).toBe('over');
    expect(store.view.value!.winner).not.toBeNull();
  });

  test('finalScores is null during the game, and matches engine.teamScore at the end', () => {
    const store = started(7);
    expect(store.finalScores()).toBeNull();
    for (let i = 0; i < 37; i++) {
      store.confirmRound();
      store.confirmContacts();
      store.next();
    }
    const scores = store.finalScores()!;
    for (const side of ['blue', 'red'] as const) {
      const s = scores[side];
      expect(s.gold + s.objectives + s.plates + s.towers).toBe(s.total);
    }
    const winner = store.view.value!.winner;
    if (winner === 'draw') expect(scores.blue.total).toBe(scores.red.total);
    else expect(scores[winner!].total).toBeGreaterThan(scores[winner === 'blue' ? 'red' : 'blue'].total);
  });

  test('roundWindow and level follow the engine', () => {
    const store = started();
    expect(store.roundWindow()).toEqual(engine.roundWindow(data.rules, 1));
    expect(store.totalRounds()).toBe(37);
    expect(store.level(data.rules.economy.levelXp[2]!)).toBe(3);
  });

  test('spawnPointsFor lists the engine spawn points of a blue champion', () => {
    const store = started();
    const top = blue(store, 'top');
    expect(store.spawnPointsFor(top.id)).toContain('top-t1-blue');
  });

  test('a recalled champion is listed in recalled while respawning, a dead one is not', () => {
    const store = started();
    const top = blue(store, 'top');
    store.setRecall(top.id);
    store.confirmRound();
    store.confirmContacts();
    const after = blue(store, 'top');
    expect(after.status).toBe('respawning');
    expect(store.recalled.value).toEqual([top.id]);
    store.next();
    store.setSpawn(top.id, store.spawnPointsFor(top.id)[0]!);
    store.confirmRound();
    store.confirmContacts();
    expect(store.recalled.value).not.toContain(top.id);
  });

  test('reset returns to the start screen and drops the game', () => {
    const store = started();
    store.setRecall(blue(store, 'top').id);
    store.reset();
    expect(store.screen.value).toBe('start');
    expect(store.view.value).toBeNull();
    expect(store.pending.value).toEqual({});
    expect(store.finalScores()).toBeNull();
    store.start({ rank: 'iron', teaching: false, seed: 3 });
    expect(store.screen.value).toBe('orders');
  });

  test('setLaunchHerald needs the herald and keeps the move', () => {
    const store = started();
    const top = blue(store, 'top');
    expect(() => store.setLaunchHerald(top.id, true)).toThrow(/herald/);
    store.setLaunchHerald(top.id, false);
    expect(store.pending.value[top.id]).toEqual({ kind: 'move', champion: top.id, to: top.position });
  });

  test('resolving a round keeps the previous view and starts the replay; skip, replay and next drive it', () => {
    const store = started();
    const before = store.view.value!;
    store.confirmRound();
    store.confirmContacts();
    expect(store.screen.value).toBe('review');
    expect(store.previousView.value).toBe(before);
    expect(store.view.value).not.toBe(before);
    expect(store.replaying.value).toBe(true);
    const run = store.replayRun.value;
    store.skipReplay();
    expect(store.replaying.value).toBe(false);
    store.replay();
    expect(store.replaying.value).toBe(true);
    expect(store.replayRun.value).toBe(run + 1);
    store.next();
    expect(store.previousView.value).toBeNull();
    expect(store.replaying.value).toBe(false);
    store.replay();
    expect(store.replaying.value).toBe(false);
  });
});
