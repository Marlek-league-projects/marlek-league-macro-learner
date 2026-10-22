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
  expect(g.distance('raptors-blue', 'bluebuff-red')).toBe(2);
  expect(g.distance('gromp-blue', 'raptors-blue')).toBe(2);
  expect(g.distance('wolves-blue', 'raptors-blue')).toBe(1);
  expect(g.distance('wolves-red', 'raptors-red')).toBe(1);
  expect(g.distance('gromp-blue', 'krugs-blue')).toBe(3);
});
test('one step: the T3s of a side, the mid T2 to the top and bot T2, Wolves and Gromp, Raptors and Krugs', () => {
  for (const side of ['blue', 'red']) {
    const one = [
      [`top-t3-${side}`, `mid-t3-${side}`], [`mid-t3-${side}`, `bot-t3-${side}`], [`top-t3-${side}`, `bot-t3-${side}`],
      [`mid-t2-${side}`, `top-t2-${side}`], [`mid-t2-${side}`, `bot-t2-${side}`],
      [`wolves-${side}`, `gromp-${side}`], [`raptors-${side}`, `krugs-${side}`],
      ['mid-lane', `wolves-${side}`], ['mid-lane', `raptors-${side}`], [`raptors-${side}`, `mid-t2-${side}`],
    ];
    for (const [a, b] of one) expect(`${a} ${b} ${g.distance(a!, b!)}`).toBe(`${a} ${b} 1`);
  }
});
test('crossing the own jungle goes through the mid T1, on both sides', () => {
  for (const [a, b, m] of [['wolves-blue', 'krugs-blue', 'mid-t1-blue'], ['wolves-red', 'krugs-red', 'mid-t1-red']] as const) {
    expect(g.distance(a, b)).toBe(2);
    expect(g.adj[m]).toContain(b);
    expect(g.adj[m]).toContain(a);
  }
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
test('136 undirected edges, every one mirrored', () => {
  const edges = new Set<string>();
  for (const [a, ns] of Object.entries(g.adj)) for (const b of ns) edges.add([a, b].sort().join('|'));
  expect(edges.size).toBe(136);
  for (const e of edges) {
    const [a, b] = e.split('|') as [string, string];
    expect(g.adj[mirrorId(a)]).toContain(mirrorId(b));
  }
});

test('no lane T1 links to the enemy T1 of its lane', () => {
  for (const lane of ['top', 'mid', 'bot']) expect(g.adj[`${lane}-t1-blue`]).not.toContain(`${lane}-t1-red`);
});

test('each river position links the lanes and camps of the brief, on both sides', () => {
  const sorted = (id: string): string[] => [...g.adj[id]!].sort();
  expect(sorted('scuttle-top')).toEqual(
    ['baron-pit', 'bluebuff-blue', 'gromp-blue', 'krugs-red', 'mid-lane', 'mid-t1-blue', 'mid-t1-red', 'raptors-red',
      'redbuff-red', 'top-lane', 'top-t1-blue', 'top-t1-red', 'wolves-blue'].sort(),
  );
  // Whatever is 1 step from a Scuttle is 1 step from the pit next to it.
  expect(sorted('baron-pit')).toEqual(sorted('scuttle-top').filter((p) => p !== 'baron-pit').concat('scuttle-top').sort());
  expect(sorted('scuttle-bot')).toEqual(sorted('scuttle-top').map(mirrorId).sort());
  expect(sorted('dragon-pit')).toEqual(sorted('baron-pit').map(mirrorId).sort());
});
