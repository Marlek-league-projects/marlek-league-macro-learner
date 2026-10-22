import { mirrorId } from '@lml/data';
import type { GameData, Lane, Role, Rules, Side } from '@lml/data/contracts';
import type { ChampionState, GameState, Order, PlayerView, Stance } from './contracts';
import { frontTower } from './lanes';
import { roundWindow } from './time';

export const HOME_LANE: Record<Exclude<Role, 'jungle'>, Lane> = { top: 'top', mid: 'mid', adc: 'bot', support: 'bot' };
const STANCES: Stance[] = ['push', 'farm', 'trade', 'allin'];

/** Steps every champion may take in `round`: `moves.budgetBySeconds` for that round's length. */
export function stepBudget(rules: Rules, round: number): number {
  const seconds = roundWindow(rules, round).seconds;
  const budget = rules.moves.budgetBySeconds[String(seconds)];
  if (budget === undefined) throw new Error(`no step budget for ${seconds}s rounds`);
  return budget;
}

/** Steps for a `side` move starting on `from` in `round`: the round's budget, plus `moves.baseBonus` from its own base. */
export function budgetFrom(rules: Rules, round: number, from: string, side: Side): number {
  return stepBudget(rules, round) + (from === `base-${side}` ? rules.moves.baseBonus : 0);
}

/** Where a champion's move starts this round: its base when respawning, else where it stands. */
export function moveStart(c: Pick<ChampionState, 'status' | 'position' | 'side'>): string {
  return c.status === 'respawning' ? `base-${c.side}` : c.position;
}

/** An action (clear a camp, take an objective, farm the wave, recall) costs a step: it needs one left on arrival. */
export function canAct(distance: number, budget: number): boolean {
  return distance < budget;
}

const enemyBase = (side: Side): string => `base-${side === 'blue' ? 'red' : 'blue'}`;

function find(state: GameState, championId: string): ChampionState {
  const c = state.champions.find((x) => x.id === championId);
  if (!c) throw new Error(`${championId}: unknown champion`);
  return c;
}

/** `budgetFrom` for the champion's move this round (see `moveStart`). */
export function stepBudgetFor(state: GameState, data: GameData, championId: string): number {
  const c = find(state, championId);
  return budgetFrom(data.rules, state.round, moveStart(c), c.side);
}

/**
 * Position to distance for everything the champion can reach this round, incl. where its move starts (0): its own
 * position, or its base when respawning (see `moveStart`, `budgetFrom`).
 */
export function reachable(state: GameState, data: GameData, championId: string): Record<string, number> {
  const c = find(state, championId);
  const from = moveStart(c);
  return reachableFrom(data, from, budgetFrom(data.rules, state.round, from, c.side), c.side);
}

/** True when a step from `a` to `b` goes between two lane positions (tower or lane middle) of different lanes. */
export function isLaneChange(data: GameData, a: string, b: string): boolean {
  const pa = data.graph.positions[a];
  const pb = data.graph.positions[b];
  const onLane = (p: typeof pa): boolean => p?.kind === 'tower' || p?.kind === 'laneMid';
  return !!pa && !!pb && onLane(pa) && onLane(pb) && pa.lane !== undefined && pb.lane !== undefined && pa.lane !== pb.lane;
}

/**
 * Walks the graph from `position` for a `side` champion (the enemy base is off limits), at most `budget` steps.
 * `arrival`: shortest distance to every position reached. `onward`: distance at which a position can be left again;
 * changing lane ends the move (see `isLaneChange`), so a position reached that way is not left from there.
 */
function walk(data: GameData, position: string, budget: number, side: Side): { arrival: Record<string, number>; onward: Record<string, number> } {
  const banned = enemyBase(side);
  const arrival: Record<string, number> = { [position]: 0 };
  const onward: Record<string, number> = { [position]: 0 };
  const queue = [position];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    const d = onward[cur]! + 1;
    if (d > budget) continue;
    for (const n of data.graph.adj[cur] ?? []) {
      if (n === banned) continue;
      if (arrival[n] === undefined) arrival[n] = d;
      if (onward[n] === undefined && !isLaneChange(data, cur, n)) {
        onward[n] = d;
        queue.push(n);
      }
    }
  }
  return { arrival, onward };
}

/** Position to distance within `budget` steps of `position` for a `side` champion (see `walk`). */
export function reachableFrom(data: GameData, position: string, budget: number, side: Side): Record<string, number> {
  return walk(data, position, budget, side).arrival;
}

/** Route preference between shortest paths: a lane position, then a camp, then a Scuttle (and anything else), then a pit. */
const rank = (data: GameData, id: string): number => {
  const kind = data.graph.positions[id]?.kind;
  return kind === 'tower' || kind === 'laneMid' ? 0 : kind === 'camp' ? 1 : kind === 'pit' ? 3 : 2;
};

/**
 * The deterministic shortest path a `side` champion walks from `from` to `to`, both ends included, under the
 * movement rules (enemy base off limits, changing lane ends the move). Between shortest paths each step prefers a
 * lane position, then a camp, then a Scuttle, then a pit, then the lower id (seen from blue: red takes the mirror of blue's
 * route). Throws when `to` cannot be reached.
 */
export function route(data: GameData, from: string, to: string, side: Side): string[] {
  const { arrival, onward } = walk(data, from, Infinity, side);
  const length = arrival[to];
  if (length === undefined) throw new Error(`no route from ${from} to ${to}`);
  const id = (p: string): string => (side === 'blue' ? p : mirrorId(p));
  const dead = new Set<string>();
  /** The preferred rest of the path from `cur`, left at step `i`, or null. */
  const rest = (cur: string, i: number): string[] | null => {
    if (i === length - 1) return (data.graph.adj[cur] ?? []).includes(to) ? [to] : null;
    if (dead.has(cur)) return null;
    const next = (data.graph.adj[cur] ?? [])
      .filter((n) => n !== to && onward[n] === i + 1 && !isLaneChange(data, cur, n))
      .sort((a, b) => rank(data, a) - rank(data, b) || id(a).localeCompare(id(b)));
    for (const n of next) {
      const tail = rest(n, i + 1);
      if (tail) return [n, ...tail];
    }
    dead.add(cur);
    return null;
  };
  return length === 0 ? [from] : [from, ...rest(from, 0)!];
}

/** Where a respawning champion may re-enter: anywhere its move from its base reaches (budget + `moves.baseBonus`). */
export function spawnPoints(state: GameState, data: GameData, championId: string): string[] {
  return spawnPointsFor({ allies: state.champions, round: state.round }, data, championId);
}

/** `spawnPoints` from what a side knows: its own champions and the round, nearest first. */
export function spawnPointsFor(view: Pick<PlayerView, 'allies' | 'round'>, data: GameData, championId: string): string[] {
  const c = view.allies.find((x) => x.id === championId);
  if (!c) throw new Error(`${championId}: unknown champion`);
  const base = `base-${c.side}`;
  const reach = reachableFrom(data, base, budgetFrom(data.rules, view.round, base, c.side), c.side);
  return Object.keys(reach).sort((a, b) => reach[a]! - reach[b]! || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * One step toward `side`'s base for a champion fleeing a tile it did not leave: along a lane to the next
 * position behind it (T1 → T2 → T3 → base), elsewhere to the neighbour closest to the base. Ties by id, seen from
 * blue (red takes the mirror of blue's step, as in `route`).
 */
export function retreatStep(data: GameData, side: Side, position: string): string {
  const { graph } = data;
  const base = `base-${side}`;
  const lane = graph.positions[position]?.lane;
  const options = (graph.adj[position] ?? []).filter(
    (n) => n !== enemyBase(side) && (lane === undefined || n === base || graph.positions[n]?.lane === lane),
  );
  const id = (p: string): string => (side === 'blue' ? p : mirrorId(p));
  const best = options.sort((a, b) => graph.distance(a, base) - graph.distance(b, base) || id(a).localeCompare(id(b)))[0];
  return best !== undefined && graph.distance(best, base) < graph.distance(position, base) ? best : position;
}

function fail(champion: string, reason: string): never {
  throw new Error(`${champion}: ${reason}`);
}

function validateOne(state: GameState, data: GameData, c: ChampionState, o: Order, ctx: { wards: number; unwards: number }): void {
  const { graph, rules } = data;
  if (c.status === 'dead') fail(c.id, 'dead champion takes no order');
  if (o.stance !== undefined && !STANCES.includes(o.stance)) fail(c.id, `unknown stance ${String(o.stance)}`);
  if (c.status === 'respawning') {
    if (o.kind !== 'spawn') fail(c.id, 'respawning champion can only spawn');
    if (!spawnPoints(state, data, c.id).includes(o.to)) fail(c.id, `invalid spawn point ${o.to}`);
    return;
  }
  if (o.kind === 'spawn') fail(c.id, 'cannot spawn while alive');

  if (o.kind === 'recall') {
    if (o.ward) {
      ctx.wards++;
      if (o.ward === 'to' && o.to === undefined) fail(c.id, 'recall ward at the step needs a step position');
    }
    if (o.unward !== undefined) {
      ctx.unwards++;
      if (!rules.wards.unwardRoles.includes(c.role)) fail(c.id, `${c.role} cannot unward`);
      if (o.unward === 'to' && o.to === undefined) fail(c.id, 'recall unward at the step needs a step position');
    }
    // The recall is the action: its step leaves it a step of the budget, never into the enemy base.
    const stepReach = reachableFrom(data, c.position, budgetFrom(rules, state.round, c.position, c.side) - 1, c.side);
    if (o.to !== undefined && stepReach[o.to] === undefined) fail(c.id, `recall step to ${o.to} is out of range`);
    return;
  }

  const reach = reachable(state, data, c.id);
  if (reach[o.to] === undefined) fail(c.id, `cannot reach ${o.to}`);
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

/**
 * Where a laner follows its wave in `lane`: wave -1 the blue front tower, 0 the lane middle, +1 the red front tower
 * (a side with no standing tower left in the lane: its last tower position).
 */
function wavePosition(state: GameState, data: GameData, lane: Lane): string {
  const wave = state.waves[lane];
  if (wave === 0) return data.graph.lanePositions(lane).find((id) => data.graph.positions[id]!.kind === 'laneMid')!;
  const side: Side = wave === -1 ? 'blue' : 'red';
  return frontTower(state, data, side, lane) ?? data.graph.towers(side, lane).at(-1)!;
}

/**
 * A laner standing in its own lane follows the wave: to the wave position when it can farm there this round
 * (`canAct`), else as close to it along the lane as it can while still farming. Anywhere else (and for the
 * jungler) the champion stays put.
 */
function followWave(state: GameState, data: GameData, c: ChampionState): string {
  if (c.role === 'jungle') return c.position;
  const lane = HOME_LANE[c.role];
  if (data.graph.positions[c.position]?.lane !== lane) return c.position;
  const target = wavePosition(state, data, lane);
  const budget = stepBudget(data.rules, state.round);
  const reach = reachable(state, data, c.id);
  const farming = Object.keys(reach).filter((p) => canAct(reach[p]!, budget) && data.graph.positions[p]?.lane === lane);
  return farming.sort(
    (a, b) => data.graph.distance(a, target) - data.graph.distance(b, target) || (a < b ? -1 : a > b ? 1 : 0),
  )[0]!;
}

/** Whether the champion's default order is to follow its wave: an alive laner standing in its home lane. */
export function followsWave(state: GameState, data: GameData, championId: string): boolean {
  const c = state.champions.find((x) => x.id === championId);
  if (c === undefined || c.status !== 'alive' || c.role === 'jungle') return false;
  return data.graph.positions[c.position]?.lane === HOME_LANE[c.role];
}

/** Default respawn: a laner's frontmost standing tower of its home lane, the jungler's nearest own camp. */
function defaultSpawn(state: GameState, data: GameData, c: ChampionState): string {
  const points = spawnPoints(state, data, c.id);
  if (c.role === 'jungle') return points.find((p) => data.graph.positions[p]!.kind === 'camp' && data.graph.positions[p]!.side === c.side) ?? points[0]!;
  const home = data.graph.towers(c.side, HOME_LANE[c.role]).find((t) => (state.towers[t] ?? 0) > 0);
  return home !== undefined && points.includes(home) ? home : points[0]!;
}

/** Alive laners follow their wave, other alive champions stay put; respawning ones take their default spawn. */
export function defaultOrders(state: GameState, data: GameData, side: Side): Order[] {
  const out: Order[] = [];
  for (const c of state.champions.filter((x) => x.side === side)) {
    if (c.status === 'alive') out.push({ kind: 'move', champion: c.id, to: followWave(state, data, c) });
    else if (c.status === 'respawning') {
      out.push({ kind: 'spawn', champion: c.id, to: defaultSpawn(state, data, c) });
    }
  }
  return out;
}
