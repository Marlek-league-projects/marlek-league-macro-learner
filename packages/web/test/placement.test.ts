import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { createEngine, newGame } from '@lml/engine';
import { bannerPrimary, runBannerAction } from '../src/components/banner-action';
import { placementWindow, shownRound } from '../src/components/format';
import { answerQuit, askQuit, quitAsked } from '../src/components/quit';
import { createStore } from '../src/store';

const data = loadGameData();
const engine = createEngine();

function placing(seed = 1) {
  const store = createStore(data, engine);
  store.start({ rank: 'gold', teaching: false, seed });
  return store;
}
const ally = (store: ReturnType<typeof placing>, role: string) => store.view.value!.allies.find((c) => c.role === role)!;

describe('round 0 placement in the store', () => {
  test('a new game opens on the placement screen: round 0, 0:00 → 0:55, "Valider le placement"', () => {
    const store = placing();
    expect(store.screen.value).toBe('placement');
    expect(shownRound('placement', store.view.value!.round)).toBe(0);
    expect(placementWindow(data.rules)).toEqual({ start: 0, end: 55 });
    expect(bannerPrimary('placement')).toEqual({ action: 'place', label: 'Valider le placement', enter: true });
  });

  test('defaults: laners on their own T1, the jungler on its seeded buff, no camp cleared, red placed by the AI', () => {
    const store = placing(3);
    const g = newGame(data, 3);
    for (const c of store.view.value!.allies) expect(c.position).toBe(g.champions.find((x) => x.id === c.id)!.position);
    expect(ally(store, 'jungle').gold).toBe(0);
    for (const [id, t] of Object.entries(store.view.value!.camps)) {
      expect(t).toBe(data.rules.camps.firstSpawnByCamp[id.split('-')[0] as keyof typeof data.rules.camps.firstSpawnByCamp]);
    }
  });

  test('a selected champion may go to every allowed start position, at 0 steps', () => {
    const store = placing();
    const top = ally(store, 'top');
    store.select(top.id);
    const reach = store.reachableForSelected();
    expect(Object.keys(reach).sort()).toEqual([...store.placementTargets()].sort());
    expect(Object.values(reach).every((d) => d === 0)).toBe(true);
    expect(reach['bot-t3-blue']).toBe(0);
    expect(reach['scuttle-top']).toBeUndefined();
    expect(reach['top-t1-red']).toBeUndefined();
  });

  test('place, validate, then the orders of round 1 from the placed positions', () => {
    const store = placing();
    const top = ally(store, 'top');
    const jungle = ally(store, 'jungle');
    store.placeChampion(top.id, 'top-lane');
    store.placeChampion(jungle.id, 'top-lane'); // positions may be shared
    expect(() => store.placeChampion(top.id, 'scuttle-top')).toThrow();
    expect(() => store.placeChampion(top.id, 'gromp-red')).toThrow();
    expect(ally(store, 'top').position).toBe('top-lane');
    expect(ally(store, 'jungle').position).toBe('top-lane');
    expect(() => store.confirmRound()).toThrow(/orders/);
    runBannerAction(store, 'place');
    expect(store.screen.value).toBe('orders');
    expect(store.view.value!.round).toBe(1);
    expect(() => store.placeChampion(top.id, 'mid-lane')).toThrow(/placement/);
    store.select(top.id);
    expect(store.reachableForSelected()['top-lane']).toBe(0);
    store.confirmRound();
    store.confirmContacts();
    expect(['review', 'over']).toContain(store.screen.value);
  });
});

describe('Quitter la partie', () => {
  test('asks in the page first; Non keeps the game as it was', () => {
    const store = placing();
    store.confirmPlacement();
    const before = store.view.value;
    askQuit();
    expect(quitAsked.value).toBe(true);
    expect(store.screen.value).toBe('orders');
    answerQuit(store, false);
    expect(quitAsked.value).toBe(false);
    expect(store.screen.value).toBe('orders');
    expect(store.view.value).toBe(before);
  });

  test('Oui goes back to the start screen, from any game screen', () => {
    for (const stage of ['placement', 'orders', 'review'] as const) {
      const store = placing();
      if (stage !== 'placement') store.confirmPlacement();
      if (stage === 'review') {
        store.confirmRound();
        store.confirmContacts();
      }
      expect(store.screen.value).toBe(stage);
      askQuit();
      answerQuit(store, true);
      expect(quitAsked.value).toBe(false);
      expect(store.screen.value).toBe('start');
      expect(store.view.value).toBeNull();
    }
  });

  test('the confirmation never uses a browser dialog', async () => {
    for (const f of ['../src/components/QuitGame.tsx', '../src/components/quit.ts']) {
      const src = await Bun.file(new URL(f, import.meta.url)).text();
      expect(src).not.toMatch(/\b(confirm|alert|prompt)\(/);
    }
  });
});
