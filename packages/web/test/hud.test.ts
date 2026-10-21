import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { createEngine } from '@lml/engine';
import type { Contact } from '@lml/engine/contracts';
import { goldLead } from '../src/components/format';
import { HUD_DROP, HUD_RISE, hpColor, hpShare, hudTop, hudValues, powerOf, POWER_UNIT, strengths, xpProgress } from '../src/components/hud';
import { pressureDirection } from '../src/components/map-marks';
import { clampInside, contactDock, dragSpotUsable, placePopover, POPOVER_GAP, visibleRegion } from '../src/components/popover';
import { createStore, promptContacts } from '../src/store';

const data = loadGameData();

function started(seed = 1) {
  const store = createStore(data, createEngine());
  store.start({ rank: 'gold', teaching: false, seed });
  return store;
}

describe('goldLead', () => {
  test('thousands with one decimal, French comma, signed', () => {
    expect(goldLead(1234)).toBe('+1,2k');
    expect(goldLead(-3460)).toBe('−3,5k');
    expect(goldLead(1000)).toBe('+1,0k');
    expect(goldLead(12_049)).toBe('+12,0k');
  });

  test('below a thousand: the plain amount; zero has no sign', () => {
    expect(goldLead(800)).toBe('+800');
    expect(goldLead(-800)).toBe('−800');
    expect(goldLead(0.4)).toBe('0');
    expect(goldLead(0)).toBe('0');
  });
});

describe('strengths', () => {
  const engine = createEngine();

  test('every ally (dead ones too, for their card) and only visible enemies', () => {
    const store = started();
    const v = structuredClone(store.view.value!);
    v.allies[0]!.status = 'dead';
    const s = strengths(v, data, store.level, store.estimateEnemy);
    for (const c of v.allies) expect(s[c.id]).toBeDefined();
    for (const e of v.enemies) expect(s[e.id] !== undefined).toBe(e.visible && e.level !== null);
  });

  test('xp at its level floor, plus items and bonus lead', () => {
    const store = started();
    const v = structuredClone(store.view.value!);
    const a = v.allies[0]!;
    Object.assign(a, { xp: data.rules.economy.levelXp[3]! + 50, items: 2000, bonusLead: 100 });
    expect(strengths(v, data, store.level, store.estimateEnemy)[a.id]).toBe(data.rules.economy.levelXp[3]! + 2100);
  });

  test("a visible enemy's strength is the engine's estimate, not its team's gold", () => {
    const store = started();
    const v = structuredClone(store.view.value!);
    for (const c of v.allies) Object.assign(c, { xp: 0, items: 0, bonusLead: 0 });
    const top = v.allies.find((c) => c.role === 'top')!;
    const enemy = v.enemies.find((e) => e.role === 'mid')!;
    Object.assign(enemy, { visible: true, position: top.position, level: 3, hp: 60 });
    v.scoreboard.goldEarned[v.side === 'blue' ? 'red' : 'blue'] = 1_000_000;
    const est = engine.estimateEnemy(v, data, enemy);
    expect(est.items).toBe(0);
    expect(strengths(v, data, store.level, (e) => engine.estimateEnemy(v, data, e))[enemy.id])
      .toBe(est.xp + est.items + est.bonusLead);
  });

  test('same level and items as the mirror: an ally and a visible enemy show the same strength', () => {
    const store = started();
    const v = structuredClone(store.view.value!);
    const mid = v.allies.find((c) => c.role === 'mid')!;
    // Mid-level xp (not a level floor) still compares on the floor, as the enemy's level is all that shows.
    Object.assign(mid, { xp: data.rules.economy.levelXp[3]! + 50, items: 1200, bonusLead: 0 });
    const enemy = v.enemies.find((e) => e.role === 'mid')!;
    Object.assign(enemy, { visible: true, position: mid.position, level: store.level(mid.xp), hp: 100 });
    const s = strengths(v, data, store.level, (e) => engine.estimateEnemy(v, data, e));
    expect(s[enemy.id]).toBeCloseTo(s[mid.id]!);
  });
});

describe('HUD values', () => {
  test('xpProgress: share of the way to the next level, full at the last level', () => {
    const t = data.rules.economy.levelXp;
    expect(xpProgress(data, t[2]!, 3)).toBe(0);
    expect(xpProgress(data, (t[2]! + t[3]!) / 2, 3)).toBeCloseTo(0.5);
    expect(xpProgress(data, t[t.length - 1]! + 999, t.length)).toBe(1);
  });

  test('hpShare clamps to 0..1; hpColor goes from green to red', () => {
    expect(hpShare(50, 100)).toBe(0.5);
    expect(hpShare(-5, 100)).toBe(0);
    expect(hpShare(150, 100)).toBe(1);
    expect(hpColor(1)).toBe('hsl(120 75% 45%)');
    expect(hpColor(0)).toBe('hsl(0 75% 45%)');
    expect(hpColor(0.5)).toBe('hsl(60 75% 45%)');
  });

  test('hudTop: above the token, below its name near the top edge so it stays on the map', () => {
    expect(hudTop(300)).toBe(300 - HUD_RISE);
    expect(hudTop(HUD_RISE)).toBe(0);
    expect(hudTop(40)).toBe(40 + HUD_DROP);
  });

  test('power is the strength over the power unit, rounded', () => {
    expect(powerOf(0)).toBe(0);
    expect(powerOf(4549)).toBe(Math.round(4549 / POWER_UNIT));
  });

  test('ally: its HP, level, power and XP progress', () => {
    const store = started();
    const v = structuredClone(store.view.value!);
    const a = v.allies[0]!;
    const t = data.rules.economy.levelXp;
    Object.assign(a, { xp: (t[4]! + t[5]!) / 2, items: 1000, bonusLead: 0, hp: 40 });
    const h = hudValues(v, data, store.level, store.estimateEnemy)[a.id]!;
    expect(h).toEqual({ hp: 0.4, level: 5, power: powerOf(t[4]! + 1000), xp: 0.5 });
  });

  test('fog of war: an unseen enemy has no HUD; a visible one shows HP and level, never XP progress', () => {
    const store = started();
    const v = structuredClone(store.view.value!);
    const enemy = v.enemies[0]!;
    Object.assign(enemy, { visible: false, level: null, hp: null });
    expect(hudValues(v, data, store.level, store.estimateEnemy)[enemy.id]).toBeUndefined();
    Object.assign(enemy, { visible: true, position: v.allies[0]!.position, level: 4, hp: 25 });
    const h = hudValues(v, data, store.level, store.estimateEnemy)[enemy.id]!;
    expect(h.hp).toBe(0.25);
    expect(h.level).toBe(4);
    expect(h.xp).toBeNull();
  });
});

describe('HP through the store', () => {
  test('playing rounds: enemy HP is null while unseen and real while seen; ally HP is a real value in range', () => {
    const store = started(42);
    const max = data.rules.health.max;
    let sawVisible = false;
    let sawUnseen = false;
    let sawHurt = false;
    for (let i = 0; i < 14 && store.screen.value !== 'over'; i++) {
      store.confirmRound();
      while (store.screen.value === 'contacts') {
        for (const c of store.contacts.value) store.choose(c.id, c.options.blue[0]!);
        store.confirmContacts();
      }
      const v = store.view.value!;
      for (const a of v.allies) {
        expect(a.hp).toBeGreaterThanOrEqual(0);
        expect(a.hp).toBeLessThanOrEqual(max);
        if (a.hp < max) sawHurt = true;
      }
      for (const e of v.enemies) {
        if (e.visible) {
          sawVisible = true;
          expect(typeof e.hp).toBe('number');
        } else {
          sawUnseen = true;
          expect(e.hp).toBeNull();
        }
      }
      if (store.screen.value === 'review') store.next();
    }
    expect(sawVisible && sawUnseen && sawHurt).toBe(true);
  });

  test('HP bar share follows the data max', () => {
    expect(hpShare(data.rules.health.max / 2, data.rules.health.max)).toBe(0.5);
  });
});

describe('placePopover', () => {
  const box = { width: 800, height: 800 };
  const pop = { width: 200, height: 160 };

  test('right of the pawn, vertically centred, when it fits', () => {
    expect(placePopover({ x: 100, y: 400 }, pop, box)).toEqual({ left: 100 + POPOVER_GAP, top: 320 });
  });

  test('left of the pawn when the right side would overflow', () => {
    expect(placePopover({ x: 700, y: 400 }, pop, box)).toEqual({ left: 700 - POPOVER_GAP - 200, top: 320 });
  });

  test('moves to the side that covers fewer of the points to avoid', () => {
    const right = [{ x: 200, y: 400 }, { x: 250, y: 380 }];
    const at = placePopover({ x: 400, y: 400 }, pop, box, right);
    expect(at).toEqual({ left: 400 + POPOVER_GAP, top: 320 });
    const both = [...right, { x: 500, y: 400 }];
    expect(placePopover({ x: 400, y: 400 }, pop, box, both)).toEqual({ left: 300, top: 400 + POPOVER_GAP });
  });

  test('inside the box near the top and bottom edges', () => {
    for (const y of [10, 790]) {
      const at = placePopover({ x: 100, y }, pop, box);
      expect(at.top).toBeGreaterThanOrEqual(0);
      expect(at.top + pop.height).toBeLessThanOrEqual(box.height);
    }
    // Squeezed right of the pawn, clamped to the top edge, when the other sides cover more.
    expect(placePopover({ x: 100, y: 10 }, pop, box, [{ x: 100, y: 100 }]).top).toBe(0);
  });

  test('a box too narrow for either side keeps it inside, pinned at the left edge when larger', () => {
    const narrow = { width: 300, height: 800 };
    const at = placePopover({ x: 150, y: 400 }, pop, narrow);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.left + pop.width).toBeLessThanOrEqual(narrow.width);
    expect(placePopover({ x: 50, y: 50 }, { width: 400, height: 900 }, narrow)).toEqual({ left: 0, top: 0 });
  });

  test('opens left of the pawn when the reachable positions are on its right', () => {
    const reachable = [{ x: 450, y: 400 }, { x: 480, y: 360 }, { x: 520, y: 440 }];
    expect(placePopover({ x: 400, y: 400 }, pop, box, reachable)).toEqual({ left: 400 - POPOVER_GAP - 200, top: 320 });
  });

  test('on a tie, the side the clamp moves least: above a pawn near the bottom edge, not squeezed beside it', () => {
    // One reachable point on each side's spot: every side covers one, but right/left/below get clamped upward.
    const anchor = { x: 400, y: 780 };
    const reachable = [{ x: 600, y: 800 }, { x: 200, y: 800 }, { x: 400, y: 590 }];
    expect(placePopover(anchor, pop, box, reachable)).toEqual({ left: 300, top: 780 - POPOVER_GAP - 160 });
  });

  test('stays inside the on-screen region when given one', () => {
    const region = { left: 0, top: 100, right: 800, bottom: 600 };
    const at = placePopover({ x: 100, y: 590 }, pop, region);
    expect(at.top + pop.height).toBeLessThanOrEqual(600);
    expect(placePopover({ x: 100, y: 105 }, pop, region).top).toBeGreaterThanOrEqual(100);
  });

  test('opens above when the reachable positions surround the pawn left, right and below', () => {
    const reachable = [{ x: 300, y: 400 }, { x: 500, y: 400 }, { x: 400, y: 500 }];
    expect(placePopover({ x: 400, y: 400 }, pop, box, reachable)).toEqual({ left: 300, top: 400 - POPOVER_GAP - 160 });
  });
});

describe('dragged panel position in the store', () => {
  test('starts next to the pawn and is kept for the session, across games', () => {
    const store = started();
    expect(store.panelAt.value).toBeNull();
    store.panelAt.value = { x: 0.1, y: 0.2 };
    store.reset();
    store.start({ rank: 'gold', teaching: false, seed: 2 });
    expect(store.panelAt.value).toEqual({ x: 0.1, y: 0.2 });
    expect(store.panelDragging.value).toBe(false);
  });
});

describe('dragged panel clamping', () => {
  const box = { width: 800, height: 900 };
  const pop = { width: 200, height: 160 };

  test('visibleRegion: the whole box when it fits the viewport', () => {
    expect(visibleRegion({ x: 300, y: 50 }, box, { width: 1440, height: 1000 }))
      .toEqual({ left: 0, top: 0, right: 800, bottom: 900 });
  });

  test('visibleRegion: cut by the viewport bottom and a box scrolled above the top', () => {
    expect(visibleRegion({ x: 300, y: 200 }, box, { width: 1440, height: 1000 }).bottom).toBe(800);
    expect(visibleRegion({ x: 300, y: -100 }, box, { width: 1440, height: 1000 }))
      .toEqual({ left: 0, top: 100, right: 800, bottom: 900 });
    expect(visibleRegion({ x: 1000, y: 0 }, box, { width: 1440, height: 1000 }).right).toBe(440);
  });

  test('visibleRegion: the whole box when it lies outside the viewport', () => {
    expect(visibleRegion({ x: 0, y: 2000 }, box, { width: 1440, height: 1000 }))
      .toEqual({ left: 0, top: 0, right: 800, bottom: 900 });
  });

  test('clampInside: a drag past any edge stops at that edge', () => {
    const r = { left: 0, top: 100, right: 800, bottom: 800 };
    expect(clampInside({ left: -50, top: 300 }, pop, r)).toEqual({ left: 0, top: 300 });
    expect(clampInside({ left: 900, top: 300 }, pop, r)).toEqual({ left: 600, top: 300 });
    expect(clampInside({ left: 100, top: 0 }, pop, r)).toEqual({ left: 100, top: 100 });
    expect(clampInside({ left: 100, top: 790 }, pop, r)).toEqual({ left: 100, top: 640 });
    expect(clampInside({ left: 100, top: 300 }, pop, r)).toEqual({ left: 100, top: 300 });
  });

  test('clampInside: a panel larger than the region is pinned to its top-left corner', () => {
    expect(clampInside({ left: 50, top: 50 }, { width: 900, height: 900 }, { left: 0, top: 100, right: 800, bottom: 800 }))
      .toEqual({ left: 0, top: 100 });
  });
});

describe('contactDock', () => {
  test('the prompts dock over the half with fewer contacts, the bottom on a tie', () => {
    expect(contactDock([0.2])).toBe('bottom');
    expect(contactDock([0.8])).toBe('top');
    expect(contactDock([0.1, 0.7, 0.9])).toBe('top');
    expect(contactDock([0.3, 0.7])).toBe('bottom');
    expect(contactDock([])).toBe('bottom');
  });
});

describe('pressureDirection', () => {
  test('blue pushes toward red towers, red the opposite way; unit length', () => {
    for (const lane of ['top', 'mid', 'bot'] as const) {
      const b = pressureDirection(data, lane, 'blue');
      const r = pressureDirection(data, lane, 'red');
      expect(Math.hypot(b.x, b.y)).toBeCloseTo(1);
      expect(r.x).toBeCloseTo(-b.x);
      expect(r.y).toBeCloseTo(-b.y);
    }
    // Mid runs from bottom-left (blue) to top-right (red).
    const mid = pressureDirection(data, 'mid', 'blue');
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.y).toBeLessThan(0);
  });
});

describe('promptContacts', () => {
  const contact = (id: string, auto = false): Contact => ({
    id,
    position: id,
    kind: 'trade',
    blue: ['a'],
    red: ['b'],
    options: { blue: ['farm'], red: ['farm'] },
    defaults: { blue: 'farm', red: 'farm' },
    invader: null,
    auto,
  });

  test('automatic contacts are not prompted', () => {
    const shown = promptContacts([contact('top-lane', true), contact('mid-lane'), contact('bot-lane', false)]);
    expect(shown.map((c) => c.id)).toEqual(['mid-lane', 'bot-lane']);
  });
});

describe('store stance and move + recall', () => {
  const laner = (store: ReturnType<typeof started>) => store.view.value!.allies.find((c) => c.role === 'mid')!;

  test('a stance alone keeps the default order and adds the stance', () => {
    const store = started();
    const mid = laner(store);
    store.setStance(mid.id, 'allin');
    const o = store.pending.value[mid.id]!;
    expect(o.kind).toBe('move');
    if (o.kind !== 'move') throw new Error('move expected');
    expect(o.stance).toBe('allin');
    expect(o.to).toBeDefined();
  });

  test('the stance survives a later move and a recall', () => {
    const store = started();
    const mid = laner(store);
    store.setStance(mid.id, 'trade');
    store.select(mid.id);
    const step = Object.entries(store.reachableForSelected()).find(([, d]) => d === 1)![0];
    store.setMove(mid.id, step);
    expect(store.pending.value[mid.id]).toMatchObject({ kind: 'move', to: step, stance: 'trade' });
    store.setRecall(mid.id);
    expect(store.pending.value[mid.id]).toMatchObject({ kind: 'recall', to: step, stance: 'trade' });
  });

  test('recall after a 1-step move walks there first; after a 2-step move it recalls in place', () => {
    const store = started();
    const jg = store.view.value!.allies.find((c) => c.role === 'jungle')!;
    store.select(jg.id);
    const reach = Object.entries(store.reachableForSelected());
    const one = reach.find(([, d]) => d === 1)![0];
    const two = reach.find(([, d]) => d === 2)![0];
    store.setMove(jg.id, one);
    store.setRecall(jg.id);
    expect(store.pending.value[jg.id]).toEqual({ kind: 'recall', champion: jg.id, to: one });
    store.setMove(jg.id, two);
    store.setRecall(jg.id);
    expect(store.pending.value[jg.id]).toEqual({ kind: 'recall', champion: jg.id });
  });
});

describe('after the merge with the engine lanes (Task 2)', () => {
  const engine = createEngine();

  test('a stance alone keeps the engine follow-the-wave default move', () => {
    const store = started();
    const state = engine.newGame(data, 1);
    for (const c of store.view.value!.allies.filter((a) => a.role !== 'jungle')) {
      store.setStance(c.id, 'trade');
      const def = engine.defaultOrders(state, data, 'blue').find((o) => o.champion === c.id)!;
      expect(store.pending.value[c.id]).toEqual({ ...def, stance: 'trade' });
    }
  });

  test('stances and a move + recall pass validation and the round resolves; the stance sticks', () => {
    const store = started();
    const allies = store.view.value!.allies;
    const mid = allies.find((c) => c.role === 'mid')!;
    const top = allies.find((c) => c.role === 'top')!;
    store.setStance(top.id, 'allin');
    store.select(mid.id);
    const step = Object.entries(store.reachableForSelected()).find(([, d]) => d === 1)![0];
    store.setMove(mid.id, step);
    store.setRecall(mid.id);
    expect(store.pending.value[mid.id]).toMatchObject({ kind: 'recall', to: step });
    store.confirmRound();
    if (store.screen.value === 'contacts') store.confirmContacts();
    expect(store.screen.value).toBe('review');
    expect(store.view.value!.round).toBe(2);
    expect(store.view.value!.allies.find((c) => c.id === top.id)!.stance).toBe('allin');
  });

  test('automatic lane contacts never reach the prompts and still resolve', () => {
    const store = started(1);
    let autoTrades = 0;
    for (let round = 1; round <= 12 && store.screen.value === 'orders'; round++) {
      store.confirmRound();
      if ((store.screen.value as string) === 'contacts') {
        for (const c of store.contacts.value) expect(c.auto).toBe(false);
        store.confirmContacts();
      }
      autoTrades += store.lastEvents.value.filter((e) => e.type === 'trade').length;
      store.next();
    }
    expect(autoTrades).toBeGreaterThan(0);
  });
});

describe('dragSpotUsable', () => {
  const pop = { width: 100, height: 100 };
  const anchor = { x: 300, y: 300 };
  const avoid = [{ x: 350, y: 300 }, { x: 400, y: 300 }, { x: 600, y: 600 }, { x: 700, y: 700 }];

  test('clear of the pawn and its moves: usable', () => {
    expect(dragSpotUsable({ left: 0, top: 0 }, pop, anchor, avoid)).toBe(true);
  });

  test('covering the pawn: not usable', () => {
    expect(dragSpotUsable({ left: 250, top: 250 }, pop, { x: 300, y: 300 }, [])).toBe(false);
  });

  test('covering most of the reachable positions: not usable', () => {
    expect(dragSpotUsable({ left: 340, top: 200 }, pop, { x: 100, y: 100 }, [
      { x: 350, y: 250 }, { x: 400, y: 250 }, { x: 420, y: 260 }, { x: 900, y: 900 },
    ])).toBe(false);
  });
});

describe('panelDragging', () => {
  test('is cleared by the store transitions, so a stuck drag cannot swallow clicks', () => {
    const store = started();
    store.panelDragging.value = true;
    store.confirmRound();
    expect(store.panelDragging.value).toBe(false);
    store.panelDragging.value = true;
    store.reset();
    expect(store.panelDragging.value).toBe(false);
  });

  test('is cleared when the next round starts', () => {
    const store = started();
    store.confirmRound();
    if (store.screen.value === 'contacts') store.confirmContacts();
    store.panelDragging.value = true;
    store.next();
    expect(store.panelDragging.value).toBe(false);
  });
});
