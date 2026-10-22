import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { createEngine, newGame } from '@lml/engine';
import { bannerPrimary, runBannerAction } from '../src/components/banner-action';
import { placementWindow, shownRound } from '../src/components/format';
import { answerQuit, askQuit } from '../src/components/quit';
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

  test('round 0 is simultaneous: no enemy is visible or known while placing; round 1 shows the enemy jungler', () => {
    const store = placing(9);
    const v = store.view.value!;
    expect(v.enemies.every((e) => !e.visible && e.position === null && e.lastSeenRound === null && e.level === null)).toBe(true);
    expect(v.pressure).toEqual({ top: null, mid: null, bot: null });
    store.placeChampion(ally(store, 'top').id, 'top-lane');
    expect(store.view.value!.enemies.every((e) => !e.visible && e.position === null)).toBe(true);
    store.confirmPlacement();
    const redJungler = newGame(data, 9).champions.find((c) => c.side === 'red' && c.role === 'jungle')!;
    const e = store.view.value!.enemies.find((x) => x.id === redJungler.id)!;
    expect(e).toMatchObject({ visible: true, position: redJungler.position });
    expect(['bluebuff-red', 'redbuff-red']).toContain(e.position!);
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
    askQuit(store);
    expect(store.quitAsked.value).toBe(true);
    expect(store.screen.value).toBe('orders');
    answerQuit(store, false);
    expect(store.quitAsked.value).toBe(false);
    expect(store.screen.value).toBe('orders');
    expect(store.view.value).toBe(before);
  });

  /** A store on `stage`: placement, orders, contacts (a prompted contact), review or over. */
  const on = (stage: 'placement' | 'orders' | 'contacts' | 'review' | 'over') => {
    for (let seed = 1; seed < 40; seed++) {
      const store = placing(seed);
      if (stage === 'placement') return store;
      store.confirmPlacement();
      if (stage === 'orders') return store;
      while (store.screen.value !== 'over') {
        store.confirmRound();
        if (store.screen.value === 'contacts' && stage === 'contacts') return store;
        store.confirmContacts();
        if (store.screen.value === stage) return store;
        store.next();
      }
      if (stage === 'over') return store;
    }
    throw new Error(`no game reaches ${stage}`);
  };

  test('Oui goes back to the start screen, from every game screen', () => {
    for (const stage of ['placement', 'orders', 'contacts', 'review', 'over'] as const) {
      const store = on(stage);
      expect(store.screen.value).toBe(stage);
      askQuit(store);
      answerQuit(store, true);
      expect(store.quitAsked.value).toBe(false);
      expect(store.screen.value).toBe('start');
      expect(store.view.value).toBeNull();
    }
  });

  test('an unanswered question never leaks into the next game (GameOver "Nouvelle partie" resets directly)', () => {
    const store = placing();
    askQuit(store);
    store.reset();
    expect(store.quitAsked.value).toBe(false);
    askQuit(store);
    store.start({ rank: 'gold', teaching: false, seed: 2 });
    expect(store.quitAsked.value).toBe(false);
  });

  test('the confirmation never uses a browser dialog', async () => {
    for (const f of ['../src/components/QuitGame.tsx', '../src/components/quit.ts']) {
      const src = await Bun.file(new URL(f, import.meta.url)).text();
      expect(src).not.toMatch(/\b(confirm|alert|prompt)\(/);
    }
  });
});
