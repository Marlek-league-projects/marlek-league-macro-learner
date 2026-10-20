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
});
