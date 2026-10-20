import { expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
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
  expect(roundWindow(d.rules, 1)).toMatchObject({ start: 90, end: 110, stage: 0 });
  expect(roundWindow(d.rules, 6).end).toBe(210);
  expect(roundWindow(d.rules, 15)).toMatchObject({ start: 370, end: 410, stage: 2 });
  expect(roundWindow(d.rules, 37).end).toBe(1510);
  expect(totalRounds(d.rules)).toBe(37);
  expect(() => roundWindow(d.rules, 38)).toThrow();
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
  const startCamps = g.champions.filter((c) => c.role === 'jungle').map((c) => c.position);
  expect(Object.entries(g.camps).every(([id, t]) => startCamps.includes(id) || t === 90)).toBe(true);
  expect(g.scuttles).toEqual({ 'scuttle-top': 210, 'scuttle-bot': 210 });

  const bj = g.champions.find((c) => c.side === 'blue' && c.role === 'jungle')!;
  const rj = g.champions.find((c) => c.side === 'red' && c.role === 'jungle')!;
  expect(g.lastSeen.blue[rj.id]).toEqual({ position: rj.position, round: 0 });
  expect(g.lastSeen.red[bj.id]).toEqual({ position: bj.position, round: 0 });
  expect(Object.values(g.lastSeen.blue).filter((v) => v === null)).toHaveLength(4);

  expect(g.pits['dragon-pit'].nextSpawn).toBe(300);
  expect(g.pits['baron-pit']).toEqual({ objective: null, nextSpawn: 360, capture: null });
  expect(g.rngState).not.toBe(7);
});

test('each jungler has already cleared its start buff camp', () => {
  const { camps } = d.rules;
  for (const seed of [1, 2, 3, 4, 7]) {
    const g = newGame(d, seed);
    for (const side of ['blue', 'red'] as const) {
      const j = g.champions.find((c) => c.side === side && c.role === 'jungle')!;
      expect([`bluebuff-${side}`, `redbuff-${side}`]).toContain(j.position);
      expect(g.camps[j.position]).toBe(camps.firstSpawn + camps.buffRespawn);
      expect(g.campsSeen[side][j.position]).toBe(camps.firstSpawn + camps.buffRespawn);
      const otherBuff = j.position.startsWith('bluebuff') ? `redbuff-${side}` : `bluebuff-${side}`;
      expect(g.camps[otherBuff]).toBe(camps.firstSpawn);
      expect(j.gold).toBe(camps.buffGold);
      expect(j.goldEarned).toBe(camps.buffGold);
      expect(j.xp).toBe(camps.buffXp);
      const enemy = side === 'blue' ? 'red' : 'blue';
      expect(g.lastSeen[enemy][j.id]).toEqual({ position: j.position, round: 0 });
    }
    for (const c of g.champions.filter((x) => x.role !== 'jungle')) expect([c.gold, c.xp]).toEqual([0, 0]);
  }
});
