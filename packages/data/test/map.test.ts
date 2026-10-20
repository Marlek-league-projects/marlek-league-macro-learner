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
test('every camp reaches both scuttles and both pits in at most 2 moves', () => {
  for (const side of ['blue', 'red'])
    for (const camp of ['gromp', 'bluebuff', 'wolves', 'raptors', 'redbuff', 'krugs'])
      for (const obj of ['scuttle-top', 'scuttle-bot', 'baron-pit', 'dragon-pit'])
        expect(g.distance(`${camp}-${side}`, obj)).toBeLessThanOrEqual(2);
});
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
