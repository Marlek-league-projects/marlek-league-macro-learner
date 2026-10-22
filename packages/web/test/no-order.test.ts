import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { createEngine } from '@lml/engine';
import { idleText, noOrderText } from '../src/components/format';
import { createStore } from '../src/store';

const data = loadGameData();
const engine = createEngine();

function started() {
  const store = createStore(data, engine);
  store.start({ rank: 'gold', teaching: true, seed: 1 });
  store.confirmPlacement();
  return store;
}
const ally = (store: ReturnType<typeof started>, role: string) => store.view.value!.allies.find((c) => c.role === role)!;

describe('no-order indicator', () => {
  test('the idle jungler is flagged, laners following their wave are not', () => {
    const store = started();
    const jg = ally(store, 'jungle');
    expect(store.championsWithoutOrder()).toEqual([jg.id]);
    expect(store.followsWave(jg.id)).toBe(false);
    for (const role of ['top', 'mid', 'adc', 'support']) expect(store.followsWave(ally(store, role).id)).toBe(true);
  });

  test('a pending move or recall clears the flag', () => {
    const store = started();
    const jg = ally(store, 'jungle');
    store.select(jg.id);
    const to = Object.keys(store.reachableForSelected()).find((p) => p !== jg.position)!;
    store.setMove(jg.id, to);
    expect(store.championsWithoutOrder()).toEqual([]);
    store.clearOrder(jg.id);
    expect(store.championsWithoutOrder()).toEqual([jg.id]);
    store.setRecall(jg.id);
    expect(store.championsWithoutOrder()).toEqual([]);
  });

  test('a recalled (respawning) champion is not flagged', () => {
    const store = started();
    const jg = ally(store, 'jungle');
    store.select(jg.id);
    store.setRecall(jg.id);
    store.confirmRound();
    if (store.screen.value === 'contacts') store.confirmContacts();
    store.next();
    const now = ally(store, 'jungle');
    expect(now.status).toBe('respawning');
    expect(store.championsWithoutOrder()).not.toContain(jg.id);
  });

  test('round panel says "suit sa wave" for laners, "reste en place" for the idle jungler', () => {
    const store = started();
    expect(idleText(store.followsWave(ally(store, 'mid').id))).toBe('suit sa wave');
    expect(idleText(store.followsWave(ally(store, 'jungle').id))).toBe('reste en place');
  });

  test('format', () => {
    expect(noOrderText(['Vi', 'Galio'])).toBe('Sans ordre : Vi, Galio');
  });
});
