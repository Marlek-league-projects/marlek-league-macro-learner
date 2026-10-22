import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { createEngine } from '@lml/engine';
import type { Choice, Contact } from '@lml/engine/contracts';
import { createStore, playerDefault } from '../src/store';

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

  test('a recall with a step, a ward on the step and an unward validates and resolves end to end', () => {
    const store = started();
    const j = blue(store, 'jungle');
    store.select(j.id);
    const step = Object.entries(store.reachableForSelected()).find(([, d]) => d === 1)![0];
    store.setMove(j.id, step);
    store.setRecall(j.id);
    store.setWard(j.id, 'to');
    store.setUnward(j.id, 'to');
    expect(store.pending.value[j.id]).toMatchObject({ kind: 'recall', to: step, ward: 'to', unward: 'to' });
    store.confirmRound();
    store.confirmContacts();
    expect(store.screen.value).toBe('review');
    const v = store.view.value!;
    expect(v.wards.some((w) => w.position === step && w.side === 'blue')).toBe(true);
    expect(store.recalled.value).toContain(j.id);
  });

  test('recall orders take ward and unward on the start or the step', () => {
    const store = started();
    const j = blue(store, 'jungle');
    store.select(j.id);
    const step = Object.entries(store.reachableForSelected()).find(([, d]) => d === 1)![0];
    store.setMove(j.id, step);
    store.setRecall(j.id);
    store.setWard(j.id, 'to');
    store.setUnward(j.id, 'from');
    expect(store.pending.value[j.id]).toMatchObject({ kind: 'recall', ward: 'to', unward: 'from' });
    store.setUnward(j.id, null);
    store.setWard(j.id, null);
    const o = store.pending.value[j.id]!;
    expect('ward' in o || 'unward' in o).toBe(false);
  });

  test('unreachable move throws /reach/', () => {
    const store = started();
    expect(() => store.setMove(blue(store, 'top').id, 'base-blue')).toThrow(/reach/);
    expect(() => store.setMove(blue(store, 'top').id, 'dragon-pit')).toThrow(/reach/);
  });

  test('a move is stored without a route; routeOf gives the engine route, both ends included', () => {
    const store = started();
    const j = blue(store, 'jungle');
    store.select(j.id);
    const two = Object.entries(store.reachableForSelected()).find(([, n]) => n === 2)![0];
    store.setMove(j.id, two);
    expect(store.pending.value[j.id]).toEqual({ kind: 'move', champion: j.id, to: two });
    const path = store.routeOf(j.id, two);
    expect(path).toHaveLength(3);
    expect([path[0], path[2]]).toEqual([j.position, two]);
    expect(store.stepBudget(j.id)).toBe(2);
  });

  test('a recall keeps a pending move as its step only when the move leaves a step for the recall', () => {
    const store = started();
    const j = blue(store, 'jungle');
    store.select(j.id);
    const reach = Object.entries(store.reachableForSelected());
    const one = reach.find(([, n]) => n === 1)![0];
    const two = reach.find(([, n]) => n === 2)![0];
    expect([store.recallStep(j.id, one), store.recallStep(j.id, two)]).toEqual([true, false]);
    store.setMove(j.id, one);
    store.setRecall(j.id);
    expect(store.pending.value[j.id]).toEqual({ kind: 'recall', champion: j.id, to: one });
    store.setMove(j.id, two);
    store.setRecall(j.id);
    expect(store.pending.value[j.id]).toEqual({ kind: 'recall', champion: j.id });
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

  test('the last round replays on the game over screen', () => {
    const store = started(7);
    for (let i = 0; i < 36; i++) {
      store.confirmRound();
      store.confirmContacts();
      store.next();
    }
    const before = store.view.value!;
    store.confirmRound();
    store.confirmContacts();
    expect(store.screen.value).toBe('over');
    expect(store.previousView.value).toBe(before);
    expect(store.replaying.value).toBe(true);
    const run = store.replayRun.value;
    store.skipReplay();
    expect(store.replaying.value).toBe(false);
    store.replay();
    expect(store.replaying.value).toBe(true);
    expect(store.replayRun.value).toBe(run + 1);
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
    // No pending order: the default one (a laner in its lane follows its wave).
    expect(store.pending.value[top.id]).toEqual({ kind: 'move', champion: top.id, to: 'top-lane' });
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

  test('setStance writes the stance on the order, kept by a later move; it persists after the round', () => {
    const store = started();
    const top = blue(store, 'top');
    store.setStance(top.id, 'allin');
    const def = engine.defaultOrders(engine.newGame(data, 1), data, 'blue').find((o) => o.champion === top.id)!;
    expect(store.pending.value[top.id]).toEqual({ ...def, stance: 'allin' });
    store.setMove(top.id, top.position);
    expect(store.pending.value[top.id]).toMatchObject({ kind: 'move', to: top.position, stance: 'allin' });
    store.setRecall(top.id);
    expect(store.pending.value[top.id]).toEqual({ kind: 'recall', champion: top.id, stance: 'allin' });
    store.setMove(top.id, top.position);
    store.confirmRound();
    store.confirmContacts();
    expect(blue(store, 'top').stance).toBe('allin');
  });

  test('ward, unward and herald with no pending order keep a laner following its wave', () => {
    const store = started();
    const top = blue(store, 'top');
    const support = blue(store, 'support');
    const bot = blue(store, 'adc');
    const def = (id: string) => {
      const o = engine.defaultOrders(engine.newGame(data, 1), data, 'blue').find((x) => x.champion === id)!;
      if (o.kind !== 'move') throw new Error('expected a move');
      return o;
    };
    expect(def(top.id)).toMatchObject({ kind: 'move', to: 'top-lane' });
    store.setWard(top.id, 'to');
    expect(store.pending.value[top.id]).toEqual({ ...def(top.id), ward: 'to' });
    store.setUnward(support.id, 'to');
    expect(store.pending.value[support.id]).toEqual({ ...def(support.id), unward: 'to' });
    store.setLaunchHerald(bot.id, false);
    expect(store.pending.value[bot.id]).toEqual(def(bot.id));
  });

  test('lane contacts resolved from stances are never prompted', () => {
    let auto = 0;
    const spy = {
      ...engine,
      detectContacts: (...args: Parameters<typeof engine.detectContacts>) => {
        const cs = engine.detectContacts(...args);
        auto += cs.filter((c) => c.auto).length;
        return cs;
      },
    };
    const store = createStore(data, spy);
    store.start({ rank: 'gold', teaching: false, seed: 2 });
    while (store.screen.value !== 'over') {
      store.confirmRound();
      expect(store.contacts.value.every((c) => !c.auto)).toBe(true);
      store.confirmContacts();
      store.next();
    }
    expect(auto).toBeGreaterThan(0);
  });

  test('objective prompt: doing it is a stay order, another order selects the token; both close it until next round', () => {
    const store = started();
    const j = blue(store, 'jungle');
    const s = blue(store, 'support');
    const { doObjective } = store; // works unbound, e.g. passed as a callback
    doObjective(j.id);
    expect(store.pending.value[j.id]).toMatchObject({ kind: 'move', champion: j.id, to: j.position });
    store.otherOrder(s.id);
    expect(store.selected.value).toBe(s.id);
    expect(store.objectivePromptsClosed.value).toEqual([j.id, s.id]);
    store.confirmRound();
    store.confirmContacts();
    store.next();
    expect(store.objectivePromptsClosed.value).toEqual([]);
  });

  test('a contact offering the objective preselects it; otherwise the contact default', () => {
    const contact = (blue: Choice[]): Contact => ({
      id: 'river-bot', kind: 'objective', position: 'dragon-pit', positions: ['dragon-pit'], blue: [], red: [],
      options: { blue, red: ['fight', 'flee'] }, defaults: { blue: 'flee', red: 'fight' }, invader: null, auto: false, hp: {},
    });
    expect(playerDefault(contact(['fight', 'flee', 'objective']))).toBe('objective');
    expect(playerDefault(contact(['fight', 'flee']))).toBe('flee');
  });

  test('round 1 budget: the engine decides who can act on arrival', () => {
    const store = started();
    const id = store.view.value!.allies[0]!.id;
    expect(store.stepBudget(id)).toBe(engine.stepBudget(data.rules, 1));
    expect(store.canAct(0, id)).toBe(true);
    expect(store.canAct(store.stepBudget(id), id)).toBe(false);
  });
});
