import type { CampType, Lane, MapData, MapGraph, Position, Side } from './types';

const swapSide = (s: string): string => s.replace(/\b(blue|red)$/, (m) => (m === 'blue' ? 'red' : 'blue'));

export function mirrorId(id: string): string {
  if (id === 'baron-pit') return 'dragon-pit';
  if (id === 'dragon-pit') return 'baron-pit';
  if (id === 'scuttle-top') return 'scuttle-bot';
  if (id === 'scuttle-bot') return 'scuttle-top';
  let out = swapSide(id);
  if (out.startsWith('top-')) out = 'bot-' + out.slice(4);
  else if (out.startsWith('bot-')) out = 'top-' + out.slice(4);
  return out;
}

const CAMPS = ['bluebuff', 'gromp', 'wolves', 'raptors', 'redbuff', 'krugs'];

function derive(p: MapData['positions'][number]): Position {
  const { id } = p;
  let m: RegExpMatchArray | null;
  if ((m = id.match(/^(top|mid|bot)-t([123])-(blue|red)$/))) {
    return { ...p, kind: 'tower', lane: m[1] as Lane, tier: Number(m[2]) as 1 | 2 | 3, side: m[3] as Side };
  }
  if ((m = id.match(/^(top|mid|bot)-lane$/))) return { ...p, kind: 'laneMid', lane: m[1] as Lane };
  if ((m = id.match(/^(\w+)-(blue|red)$/)) && CAMPS.includes(m[1]!)) {
    return { ...p, kind: 'camp', camp: m[1] as CampType, side: m[2] as Side };
  }
  if (id === 'baron-pit') return { ...p, kind: 'pit', pit: 'baron' };
  if (id === 'dragon-pit') return { ...p, kind: 'pit', pit: 'dragon' };
  if (id === 'scuttle-top' || id === 'scuttle-bot') return { ...p, kind: 'scuttle' };
  if ((m = id.match(/^base-(blue|red)$/))) return { ...p, kind: 'base', side: m[1] as Side };
  throw new Error(`Unknown position id: ${id}`);
}

export function buildGraph(map: MapData): MapGraph {
  const positions: Record<string, Position> = {};
  const adj: Record<string, string[]> = {};
  for (const p of map.positions) {
    positions[p.id] = derive(p);
    adj[p.id] = [];
  }
  const link = (a: string, b: string): void => {
    if (!adj[a] || !adj[b]) throw new Error(`Edge references unknown position: ${a} - ${b}`);
    if (!adj[a].includes(b)) adj[a].push(b);
    if (!adj[b].includes(a)) adj[b].push(a);
  };
  for (const [a, b] of map.edges) {
    link(a, b);
    link(mirrorId(a), mirrorId(b));
  }

  const distance = (a: string, b: string): number => {
    if (!adj[a] || !adj[b]) throw new Error(`Unknown position: ${a} / ${b}`);
    const dist: Record<string, number> = { [a]: 0 };
    const queue = [a];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i]!;
      if (cur === b) return dist[cur]!;
      for (const n of adj[cur]!) {
        if (dist[n] === undefined) {
          dist[n] = dist[cur]! + 1;
          queue.push(n);
        }
      }
    }
    return Infinity;
  };

  const all = Object.values(positions);
  return {
    positions,
    adj,
    distance,
    lanePositions: (lane) => all.filter((p) => p.lane === lane).map((p) => p.id),
    towers: (side, lane) =>
      all
        .filter((p) => p.kind === 'tower' && p.side === side && p.lane === lane)
        .sort((x, y) => x.tier! - y.tier!)
        .map((p) => p.id),
  };
}
