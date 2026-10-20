import { expect, test } from 'bun:test';
import { buildGraph, mirrorId } from '@lml/data';
import type { MapData } from '../src/contracts';
import mapJson from '../data/map.json';

const g = buildGraph(mapJson as MapData);

test('39 positions', () => expect(Object.keys(g.positions)).toHaveLength(39));
test('mirrorId', () => {
  expect(mirrorId('top-t1-blue')).toBe('bot-t1-red');
  expect(mirrorId('mid-t2-red')).toBe('mid-t2-blue');
  expect(mirrorId('raptors-blue')).toBe('raptors-red');
  expect(mirrorId('scuttle-top')).toBe('scuttle-bot');
  expect(mirrorId('baron-pit')).toBe('dragon-pit');
  expect(mirrorId('mid-lane')).toBe('mid-lane');
});
test('graph is symmetric under mirror', () => {
  for (const [a, ns] of Object.entries(g.adj)) for (const b of ns) expect(g.adj[mirrorId(a)]).toContain(mirrorId(b));
});
test('laner reach: mid T1 reaches top, bot and both scuttles in 1', () => {
  for (const p of ['top-t1-blue', 'bot-t1-blue', 'scuttle-top', 'scuttle-bot']) expect(g.distance('mid-t1-blue', p)).toBe(1);
});
test('jungler examples in 2', () => {
  expect(g.distance('raptors-blue', 'krugs-blue')).toBe(2);
  expect(g.distance('raptors-blue', 'bluebuff-red')).toBe(2);
});
test('towers ordered T1..T3', () => expect(g.towers('red', 'top')).toEqual(['top-t1-red', 'top-t2-red', 'top-t3-red']));
test('lanePositions(top) = 7 towers/laneMid, no camps', () => expect(g.lanePositions('top')).toHaveLength(7));
test('outer camps gank their lane in 1 move, on both sides', () => {
  for (const [camp, tower] of [
    ['gromp-blue', 'top-t1-blue'],
    ['bluebuff-blue', 'top-t1-blue'],
    ['krugs-blue', 'bot-t1-blue'],
    ['redbuff-blue', 'bot-t1-blue'],
    ['gromp-red', 'bot-t1-red'],
    ['bluebuff-red', 'bot-t1-red'],
    ['krugs-red', 'top-t1-red'],
    ['redbuff-red', 'top-t1-red'],
  ] as const)
    expect(g.distance(camp, tower)).toBe(1);
});
test('lane T1s and lane middle reach the nearby scuttle in 1, on both sides', () => {
  for (const p of ['top-t1-blue', 'top-lane', 'top-t1-red']) expect(g.distance(p, 'scuttle-top')).toBe(1);
  for (const p of ['bot-t1-blue', 'bot-lane', 'bot-t1-red']) expect(g.distance(p, 'scuttle-bot')).toBe(1);
});
test('laner reach from a lane T1 includes the nearby scuttle', () => {
  for (const [t1, scuttle] of [
    ['top-t1-blue', 'scuttle-top'],
    ['top-t1-red', 'scuttle-top'],
    ['bot-t1-blue', 'scuttle-bot'],
    ['bot-t1-red', 'scuttle-bot'],
  ] as const)
    expect(g.adj[t1]).toContain(scuttle);
});
test('every scuttle and pit reaches all 12 camps in 1', () => {
  const camps = Object.values(g.positions).filter((p) => p.kind === 'camp');
  expect(camps).toHaveLength(12);
  for (const river of ['scuttle-top', 'scuttle-bot', 'baron-pit', 'dragon-pit'])
    for (const camp of camps) expect(g.distance(river, camp.id)).toBe(1);
});
