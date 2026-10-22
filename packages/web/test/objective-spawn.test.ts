import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { createEngine } from '@lml/engine';
import type { PlayerView } from '@lml/engine/contracts';
import { objectivePromptEntries, pitTimer } from '../src/components/map-marks';
import { createStore, type Store } from '../src/store';

const data = loadGameData();

function started(seed = 1): Store {
  const store = createStore(data, createEngine());
  store.start({ rank: 'gold', teaching: false, seed });
  return store;
}

/** Plays idle rounds until the order phase of `round`. */
function toRound(store: Store, round: number): void {
  while (store.view.value!.round < round) {
    store.confirmRound();
    store.confirmContacts();
    store.next();
  }
}

/** The real order phase of `round`, with the blue jungler put on `at`. */
function spawnRoundView(round: number, at: string): { v: PlayerView; store: Store; id: string } {
  const store = started();
  toRound(store, round);
  const v = structuredClone(store.view.value!);
  const j = v.allies.find((c) => c.role === 'jungle')!;
  j.position = at;
  j.status = 'alive';
  return { v, store, id: j.id };
}

describe('objective offered from its spawn round', () => {
  test('round 11: the Dragon is not up in the view yet, but an ally on the pit is offered it', () => {
    const { v, store, id } = spawnRoundView(11, 'dragon-pit');
    expect(v.pits['dragon-pit'].objective).toBeNull();
    expect(v.pits['dragon-pit'].nextSpawn).toBe(300);
    expect(objectivePromptEntries(v, data, store.roundWindow(), [])).toMatchObject([{ champion: id, pit: 'dragon-pit', objective: 'dragon' }]);
  });

  test('round 10: not offered yet', () => {
    const { v, store } = spawnRoundView(10, 'dragon-pit');
    expect(objectivePromptEntries(v, data, store.roundWindow(), [])).toEqual([]);
  });

  test('round 14: the voidgrubs are offered on the Baron pit', () => {
    const { v, store, id } = spawnRoundView(14, 'baron-pit');
    expect(v.pits['baron-pit'].objective).toBeNull();
    expect(objectivePromptEntries(v, data, store.roundWindow(), [])).toMatchObject([{ champion: id, pit: 'baron-pit', objective: 'voidgrubs' }]);
  });

  test('a pending move onto the pit with a step left is offered; an arrival-only one is not', () => {
    const { v, store, id } = spawnRoundView(11, 'river-bot');
    const w = store.roundWindow();
    expect(objectivePromptEntries(v, data, w, [], { [id]: { to: 'dragon-pit', acts: true } }).map((e) => e.champion)).toEqual([id]);
    expect(objectivePromptEntries(v, data, w, [], { [id]: { to: 'dragon-pit', acts: false } })).toEqual([]);
    expect(objectivePromptEntries(v, data, w, [], {})).toEqual([]);
  });

  test('a champion with a pending recall is not offered ("Faire" would replace the recall)', () => {
    const { v, store, id } = spawnRoundView(11, 'dragon-pit');
    const w = store.roundWindow();
    expect(objectivePromptEntries(v, data, w, [])).toHaveLength(1);
    expect(objectivePromptEntries(v, data, w, [], {}, [id])).toEqual([]);
  });

  test('a champion on the pit whose pending move leaves it is not offered', () => {
    const { v, store, id } = spawnRoundView(11, 'dragon-pit');
    expect(objectivePromptEntries(v, data, store.roundWindow(), [], { [id]: { to: 'river-bot', acts: true } })).toEqual([]);
  });

  test('the store tells whether a pending move leaves a step, and doObjective keeps that move', () => {
    const store = started();
    toRound(store, 11);
    for (const ally of store.view.value!.allies) {
      store.select(ally.id);
      const d = store.reachableForSelected()['dragon-pit'];
      if (d === undefined || ally.position === 'dragon-pit') continue;
      expect(store.pendingMoveActs(ally.id)).toBeNull();
      store.setMove(ally.id, 'dragon-pit');
      expect(store.pendingMoveActs(ally.id)).toBe(store.canAct(d, ally.id));
      store.doObjective(ally.id);
      expect(store.pending.value[ally.id]).toMatchObject({ kind: 'move', to: 'dragon-pit' });
      expect(store.objectivePromptsClosed.value).toContain(ally.id);
      return;
    }
    throw new Error('no ally can reach the Dragon pit this round for this seed');
  });
});

describe('pit label', () => {
  test('"en vie" in the spawn round, a countdown before', () => {
    const store = started();
    toRound(store, 11);
    const v = store.view.value!;
    const w = store.roundWindow();
    expect(pitTimer(v, data, 'dragon-pit', w.start, w.end)).toMatchObject({ text: 'Dragon en vie', live: true });
    expect(pitTimer(v, data, 'dragon-pit', w.start)!.live).toBe(false);
    expect(pitTimer(v, data, 'baron-pit', w.start, w.end)!.live).toBe(false);
  });

  test('a capture in progress names the side and the rounds left; none without it', () => {
    const store = started();
    toRound(store, 12);
    const v = structuredClone(store.view.value!);
    v.pits['dragon-pit'] = { objective: 'dragon', nextSpawn: null, capture: { side: 'blue', startedRound: 11 } };
    const w = store.roundWindow();
    expect(pitTimer(v, data, 'dragon-pit', w.start, w.end)).toMatchObject({ text: 'Dragon — Bleu, 1 round restant', live: true });
    v.pits['dragon-pit'].capture = null;
    expect(pitTimer(v, data, 'dragon-pit', w.start, w.end)!.text).toBe('Dragon en vie');
  });

  test('an enemy capture shows only when the view carries it (the engine hides an unseen one)', () => {
    const store = started();
    toRound(store, 12);
    const v = store.view.value!;
    const w = store.roundWindow();
    const hidden = structuredClone(v);
    hidden.pits['dragon-pit'] = { objective: 'dragon', nextSpawn: null, capture: null };
    expect(pitTimer(hidden, data, 'dragon-pit', w.start, w.end)!.text).toBe('Dragon en vie');
    const seen = structuredClone(v);
    seen.pits['dragon-pit'] = { objective: 'dragon', nextSpawn: null, capture: { side: 'red', startedRound: 11 } };
    expect(pitTimer(seen, data, 'dragon-pit', w.start, w.end)!.text).toBe('Dragon — Rouge, 1 round restant');
  });
});
