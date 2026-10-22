import { expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import type { CampType } from '@lml/data/contracts';
import { newGame, roundWindow } from '@lml/engine';

const d = loadGameData();

test('2026 timers: camps first spawn per camp type, objectives from the 2026 table', () => {
  expect(d.rules.camps.firstSpawnByCamp).toEqual({ bluebuff: 55, redbuff: 55, wolves: 55, raptors: 55, krugs: 67, gromp: 67 });
  const g = newGame(d, 3);
  for (const [id, t] of Object.entries(g.camps)) {
    const camp = id.split('-')[0] as CampType;
    if (t === d.rules.camps.firstSpawnByCamp[camp]) continue;
    expect(t).toBe(d.rules.camps.firstSpawnByCamp[camp] + d.rules.camps.buffRespawn); // the jungler's cleared start buff
  }
  expect(g.camps['krugs-blue']).toBe(67);
  expect(g.camps['gromp-red']).toBe(67);
  expect(g.camps['wolves-blue']).toBe(55);
  const o = d.rules.objectives;
  expect([o.scuttle.firstSpawn, o.scuttle.respawn]).toEqual([175, 150]);
  expect([o.voidgrubs.firstSpawn, o.voidgrubs.despawnAt]).toEqual([480, 885]);
  expect([o.herald.firstSpawn, o.herald.despawnAt]).toEqual([900, 1185]);
  expect([o.dragon.firstSpawn, o.dragon.respawn, o.baron.firstSpawn, o.baron.respawn]).toEqual([300, 300, 1200, 360]);
});

test('objective spawns fall in the rounds of the 0:55 grid', () => {
  const roundOf = (t: number) => {
    for (let r = 1; r <= 73; r++) {
      const w = roundWindow(d.rules, r);
      if (t >= w.start && t < w.end) return r;
    }
    return -1;
  };
  expect(roundOf(67)).toBe(1);
  expect(roundOf(175)).toBe(7);
  expect(roundOf(300)).toBe(13);
  expect(roundOf(480)).toBe(22);
  expect(roundOf(900)).toBe(43);
});
