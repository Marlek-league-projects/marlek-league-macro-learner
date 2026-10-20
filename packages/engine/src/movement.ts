import type { GameData, Lane, Rules, Side } from '@lml/data/contracts';
import type { ChampionState, GameState, Order } from './contracts';

const LANES: Lane[] = ['top', 'mid', 'bot'];

export function movesFor(c: ChampionState, rules: Rules): number {
  return c.role === 'jungle' ? rules.moves.jungler : rules.moves.laner;
}

const enemyBase = (side: Side): string => `base-${side === 'blue' ? 'red' : 'blue'}`;

function find(state: GameState, championId: string): ChampionState {
  const c = state.champions.find((x) => x.id === championId);
  if (!c) throw new Error(`${championId}: unknown champion`);
  return c;
}

/** Position to distance for everything the champion can reach this round, incl. its own position (0). */
export function reachable(state: GameState, data: GameData, championId: string): Record<string, number> {
  const c = find(state, championId);
  const banned = enemyBase(c.side);
  const max = movesFor(c, data.rules);
  const dist: Record<string, number> = { [c.position]: 0 };
  const queue = [c.position];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    if (dist[cur]! >= max) continue;
    for (const n of data.graph.adj[cur] ?? []) {
      if (n === banned || dist[n] !== undefined) continue;
      dist[n] = dist[cur]! + 1;
      queue.push(n);
    }
  }
  return dist;
}

/** Where a respawning champion may re-enter: front standing tower per lane, or own camps for the jungler. */
export function spawnPoints(state: GameState, data: GameData, championId: string): string[] {
  const c = find(state, championId);
  const { graph } = data;
  if (c.role === 'jungle') {
    return Object.values(graph.positions)
      .filter((p) => p.kind === 'camp' && p.side === c.side)
      .map((p) => p.id);
  }
  const out: string[] = [];
  for (const lane of LANES) {
    const front = graph.towers(c.side, lane).find((t) => (state.towers[t] ?? 0) > 0);
    if (front) out.push(front);
  }
  return out.length > 0 ? out : [`base-${c.side}`];
}

function fail(champion: string, reason: string): never {
  throw new Error(`${champion}: ${reason}`);
}

function validateOne(state: GameState, data: GameData, c: ChampionState, o: Order, ctx: { wards: number; unwards: number }): void {
  const { graph, rules } = data;
  if (c.status === 'dead') fail(c.id, 'dead champion takes no order');
  if (c.status === 'respawning') {
    if (o.kind !== 'spawn') fail(c.id, 'respawning champion can only spawn');
    if (!spawnPoints(state, data, c.id).includes(o.to)) fail(c.id, `invalid spawn point ${o.to}`);
    return;
  }
  if (o.kind === 'spawn') fail(c.id, 'cannot spawn while alive');

  if (o.kind === 'recall') {
    if (o.ward) ctx.wards++;
    return;
  }

  const reach = reachable(state, data, c.id);
  if (reach[o.to] === undefined) fail(c.id, `cannot reach ${o.to}`);
  if (o.via !== undefined) {
    if (!graph.positions[o.via] || o.via === enemyBase(c.side)) fail(c.id, `invalid via ${o.via}`);
    if (graph.distance(c.position, o.via) + graph.distance(o.via, o.to) > movesFor(c, rules)) {
      fail(c.id, `via ${o.via} is out of range`);
    }
  }
  if (o.ward !== undefined) {
    ctx.wards++;
    if (typeof o.ward === 'object') {
      const p = graph.positions[o.ward.position];
      const ok =
        state.round === 1 && c.role === 'jungle' && p?.kind === 'camp' && p.side !== c.side &&
        (p.camp === 'bluebuff' || p.camp === 'raptors');
      if (!ok) fail(c.id, `ward at ${o.ward.position} is not allowed`);
    }
  }
  if (o.unward !== undefined) {
    ctx.unwards++;
    if (!rules.wards.unwardRoles.includes(c.role)) fail(c.id, `${c.role} cannot unward`);
  }
  if (o.launchHerald) {
    const p = graph.positions[o.to];
    if (!c.hasHerald) fail(c.id, 'herald not held');
    if (p?.kind !== 'tower' || p.side === c.side) fail(c.id, 'herald must target an enemy tower');
  }
}

/** Throws Error('<champion>: <reason>') on the first problem found. */
export function validateOrders(state: GameState, data: GameData, side: Side, orders: Order[]): void {
  const mine = state.champions.filter((c) => c.side === side);
  const seen = new Set<string>();
  const ctx = { wards: 0, unwards: 0 };
  for (const o of orders) {
    const c = mine.find((x) => x.id === o.champion);
    if (!c) fail(o.champion, `not a ${side} champion`);
    if (seen.has(c.id)) fail(c.id, 'duplicate order');
    seen.add(c.id);
    validateOne(state, data, c, o, ctx);
  }
  for (const c of mine) {
    if (c.status !== 'dead' && !seen.has(c.id)) fail(c.id, 'missing order');
  }
  if (ctx.wards > data.rules.wards.perRound) fail('wards', `at most ${data.rules.wards.perRound} wards per round`);
  if (ctx.unwards > data.rules.wards.unwardPerRound) {
    fail('unward', `at most ${data.rules.wards.unwardPerRound} unward per round`);
  }
}

/** First entry of spawnPoints, derived from state alone (tower ids and camp ids encode side and tier). */
function firstSpawn(state: GameState, c: ChampionState): string {
  if (c.role === 'jungle') {
    return Object.keys(state.camps).find((id) => id.endsWith(`-${c.side}`)) ?? c.position;
  }
  for (const lane of LANES) {
    for (const tier of [1, 2, 3]) {
      const id = `${lane}-t${tier}-${c.side}`;
      if ((state.towers[id] ?? 0) > 0) return id;
    }
  }
  return `base-${c.side}`;
}

/** Alive champions stay put; respawning ones take their first spawn point. Dead ones get none. */
export function defaultOrders(state: GameState, side: Side): Order[] {
  const out: Order[] = [];
  for (const c of state.champions.filter((x) => x.side === side)) {
    if (c.status === 'alive') out.push({ kind: 'move', champion: c.id, to: c.position });
    else if (c.status === 'respawning') out.push({ kind: 'spawn', champion: c.id, to: firstSpawn(state, c) });
  }
  return out;
}
