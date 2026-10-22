import { expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import type { CampType } from '@lml/data/contracts';
import { createRng, newGame, randomDraft, roundWindow, totalRounds } from '@lml/engine';

const d = loadGameData();

test('rng is deterministic per seed', () => {
  const a = createRng(42);
  const b = createRng(42);
  const xs = Array.from({ length: 5 }, () => a.next());
  expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
  expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
});

test('round windows follow the phases', () => {
  expect(roundWindow(d.rules, 1)).toMatchObject({ start: 55, end: 75, stage: 0 });
  expect(roundWindow(d.rules, 6).end).toBe(175);
  expect(roundWindow(d.rules, 7)).toMatchObject({ start: 175, end: 195, stage: 1 });
  expect(roundWindow(d.rules, 17)).toMatchObject({ start: 375, end: 395, stage: 2 });
  expect(roundWindow(d.rules, 73).end).toBe(1515);
  expect(totalRounds(d.rules)).toBe(73);
  expect(() => roundWindow(d.rules, 74)).toThrow();
});

test('randomDraft gives 10 distinct champions in their roles', () => {
  const draft = randomDraft(d, createRng(3));
  const ids = [...Object.values(draft.blue), ...Object.values(draft.red)];
  expect(new Set(ids).size).toBe(10);
  expect(d.champions[draft.red.adc]!.roles!).toContain('adc');
});

test('newGame is deterministic and well formed', () => {
  const g = newGame(d, 7);
  expect(newGame(d, 7)).toEqual(g);
  expect(g.champions).toHaveLength(10);
  expect(new Set(g.champions.map((c) => c.id)).size).toBe(10);
  expect(g.round).toBe(1);
  for (const side of ['blue', 'red'] as const) {
    const of = (role: string) => g.champions.find((c) => c.side === side && c.role === role)!;
    expect(of('top').position).toBe(`top-t1-${side}`);
    expect(of('mid').position).toBe(`mid-t1-${side}`);
    expect(of('adc').position).toBe(`bot-t1-${side}`);
    expect(of('support').position).toBe(`bot-t1-${side}`);
    expect([`bluebuff-${side}`, `redbuff-${side}`]).toContain(of('jungle').position);
  }
  expect(Object.keys(g.towers)).toHaveLength(18);
  expect(Object.values(g.towers).every((hp) => hp === 5)).toBe(true);
  expect(g.waves).toEqual({ top: 0, mid: 0, bot: 0 });
  expect(Object.entries(g.camps).every(([id, t]) => t === d.rules.camps.firstSpawnByCamp[id.split('-')[0] as CampType])).toBe(true);
  expect(g.scuttles).toEqual({ 'scuttle-top': 175, 'scuttle-bot': 175 });

  const bj = g.champions.find((c) => c.side === 'blue' && c.role === 'jungle')!;
  const rj = g.champions.find((c) => c.side === 'red' && c.role === 'jungle')!;
  expect(g.lastSeen.blue[rj.id]).toEqual({ position: rj.position, round: 0 });
  expect(g.lastSeen.red[bj.id]).toEqual({ position: bj.position, round: 0 });
  expect(Object.values(g.lastSeen.blue).filter((v) => v === null)).toHaveLength(4);

  expect(g.pits['dragon-pit'].nextSpawn).toBe(300);
  expect(g.pits['baron-pit']).toEqual({ objective: null, nextSpawn: 480, capture: null });
  expect(g.rngState).not.toBe(7);
});

test('no camp is pre-cleared: every camp first spawns at 0:55 or 1:07, every champion starts with no gold or xp', () => {
  for (const seed of [1, 2, 3, 4, 7]) {
    const g = newGame(d, seed);
    for (const [id, t] of Object.entries(g.camps)) expect(t).toBe(d.rules.camps.firstSpawnByCamp[id.split('-')[0] as CampType]);
    expect(g.campsSeen.blue).toEqual(g.camps);
    expect(g.campsSeen.red).toEqual(g.camps);
    for (const c of g.champions) expect([c.gold, c.goldEarned, c.xp]).toEqual([0, 0, 0]);
    for (const side of ['blue', 'red'] as const) {
      const j = g.champions.find((c) => c.side === side && c.role === 'jungle')!;
      expect([`bluebuff-${side}`, `redbuff-${side}`]).toContain(j.position);
      expect(g.lastSeen[side === 'blue' ? 'red' : 'blue'][j.id]).toEqual({ position: j.position, round: 0 });
    }
  }
});
