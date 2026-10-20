import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { createEngine } from '@lml/engine';
import { deepWardSpots } from '../src/components/ward-spots';
import { createStore } from '../src/store';

const data = loadGameData();

describe('deepWardSpots', () => {
  test('round 1 jungler: enemy Blue Buff and Raptors', () => {
    expect(deepWardSpots(data, { role: 'jungle', side: 'blue' }, 1)).toEqual(['bluebuff-red', 'raptors-red']);
  });
  test('none after round 1 or for a laner', () => {
    expect(deepWardSpots(data, { role: 'jungle', side: 'blue' }, 2)).toEqual([]);
    expect(deepWardSpots(data, { role: 'mid', side: 'blue' }, 1)).toEqual([]);
  });
  test('the engine accepts each spot as a ward order', () => {
    for (const position of deepWardSpots(data, { role: 'jungle', side: 'blue' }, 1)) {
      const store = createStore(data, createEngine());
      store.start({ rank: 'gold', teaching: false, seed: 1 });
      const j = store.view.value!.allies.find((c) => c.role === 'jungle')!;
      store.setWard(j.id, { position });
      expect(store.pending.value[j.id]).toMatchObject({ ward: { position } });
    }
  });
});
