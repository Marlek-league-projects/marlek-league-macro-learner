import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { createEngine } from '@lml/engine';
import type { Contact } from '@lml/engine/contracts';
import { goldLead } from '../src/components/format';
import { MIN_STRENGTH_FILL, pressureDirection, strengthFill, strengthFills } from '../src/components/map-marks';
import { placePopover, POPOVER_GAP } from '../src/components/popover';
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

describe('strengthFill', () => {
  test('share of the strongest, capped at 1', () => {
    expect(strengthFill(50, 100)).toBe(0.5);
    expect(strengthFill(100, 100)).toBe(1);
    expect(strengthFill(120, 100)).toBe(1);
  });

  test('never below the minimum sliver; nothing to compare gives a full bar', () => {
    expect(strengthFill(0, 100)).toBe(MIN_STRENGTH_FILL);
    expect(strengthFill(0, 0)).toBe(1);
  });
});

describe('strengthFills', () => {
  test('every alive ally and only visible enemies, the strongest at 1', () => {
    const store = started();
    const v = structuredClone(store.view.value!);
    const fills = strengthFills(v, data, store.level);
    for (const c of v.allies) expect(fills[c.id]).toBeDefined();
    for (const e of v.enemies) expect(fills[e.id] !== undefined).toBe(e.visible && e.level !== null);
    expect(Math.max(...Object.values(fills))).toBe(1);
  });

  test('more gold earned means a fuller bar; a dead ally has none', () => {
    const store = started();
    const v = structuredClone(store.view.value!);
    const [a, b] = v.allies.filter((c) => c.role !== 'jungle');
    a!.xp = b!.xp = 0;
    a!.bonusLead = b!.bonusLead = 0;
    a!.goldEarned = 2000;
    b!.goldEarned = 1000;
    const fills = strengthFills(v, data, store.level);
    expect(fills[a!.id]!).toBeGreaterThan(fills[b!.id]!);
    b!.status = 'dead';
    expect(strengthFills(v, data, store.level)[b!.id]).toBeUndefined();
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

  test('clamped inside the box near the top and bottom edges', () => {
    expect(placePopover({ x: 100, y: 10 }, pop, box).top).toBe(0);
    expect(placePopover({ x: 100, y: 790 }, pop, box).top).toBe(640);
  });

  test('a box too narrow for either side keeps it inside, pinned at the left edge when larger', () => {
    const narrow = { width: 300, height: 800 };
    const at = placePopover({ x: 150, y: 400 }, pop, narrow);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.left + pop.width).toBeLessThanOrEqual(narrow.width);
    expect(placePopover({ x: 50, y: 50 }, { width: 400, height: 900 }, narrow)).toEqual({ left: 0, top: 0 });
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
