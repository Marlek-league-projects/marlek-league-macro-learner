import type { GameData, Lane, Role, Rules, Side } from '@lml/data/contracts';
import type { ChampionState, GameState, Order, PlayerView, Stance } from './contracts';
import { frontTower } from './lanes';

const LANES: Lane[] = ['top', 'mid', 'bot'];
export const HOME_LANE: Record<Exclude<Role, 'jungle'>, Lane> = { top: 'top', mid: 'mid', adc: 'bot', support: 'bot' };
const STANCES: Stance[] = ['push', 'farm', 'trade', 'allin'];

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
  return reachableFrom(data, c.position, movesFor(c, data.rules), c.side, c.role);
}

/** True when a step from `a` to `b` goes between two lane positions (tower or lane middle) of different lanes. */
export function isLaneChange(data: GameData, a: string, b: string): boolean {
  const pa = data.graph.positions[a];
  const pb = data.graph.positions[b];
  const onLane = (p: typeof pa): boolean => p?.kind === 'tower' || p?.kind === 'laneMid';
  return !!pa && !!pb && onLane(pa) && onLane(pb) && pa.lane !== undefined && pb.lane !== undefined && pa.lane !== pb.lane;
}

/** Positions a jungler standing on a camp reaches within its whole move budget whatever the graph says. */
const OBJECTIVE_POSITIONS = ['scuttle-top', 'scuttle-bot', 'baron-pit', 'dragon-pit'];

/**
 * Position to distance within `moves` steps of `position` for a `side` champion (the enemy base is off limits).
 * A jungler on a camp (`moves.junglerObjectiveReach`) also reaches every objective position, at distance
 * `moves` at most: the bonus costs the whole budget. Changing lane ends the move (see `isLaneChange`).
 */
export function reachableFrom(
  data: GameData,
  position: string,
  moves: number,
  side: Side,
  role?: Role,
): Record<string, number> {
  const banned = enemyBase(side);
  const dist: Record<string, number> = { [position]: 0 };
  const queue = [position];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    if (dist[cur]! >= moves) continue;
    for (const n of data.graph.adj[cur] ?? []) {
      if (n === banned || dist[n] !== undefined) continue;
      dist[n] = dist[cur]! + 1;
      // Changing lane ends the move: the arrival position is reached but never expanded.
      if (!isLaneChange(data, cur, n)) queue.push(n);
    }
  }
  if (role === 'jungle' && data.rules.moves.junglerObjectiveReach && data.graph.positions[position]?.kind === 'camp') {
    for (const o of OBJECTIVE_POSITIONS) {
      if (dist[o] === undefined || dist[o]! > moves) dist[o] = moves;
    }
  }
  return dist;
}

/** Where a respawning champion may re-enter: front standing tower per lane, or own camps for the jungler. */
export function spawnPoints(state: GameState, data: GameData, championId: string): string[] {
  return spawnPointsFor({ allies: state.champions, towers: state.towers }, data, championId);
}

/** `spawnPoints` from what a side knows: its own champions and the tower hp. */
export function spawnPointsFor(
  view: Pick<PlayerView, 'allies' | 'towers'>,
  data: GameData,
  championId: string,
): string[] {
  const c = view.allies.find((x) => x.id === championId);
  if (!c) throw new Error(`${championId}: unknown champion`);
  const { graph } = data;
  if (c.role === 'jungle') {
    return Object.values(graph.positions)
      .filter((p) => p.kind === 'camp' && p.side === c.side)
      .map((p) => p.id);
  }
  const out: string[] = [];
  for (const lane of LANES) {
    const front = graph.towers(c.side, lane).find((t) => (view.towers[t] ?? 0) > 0);
    if (front) out.push(front);
  }
  return out.length > 0 ? out : [`base-${c.side}`];
}

/**
 * One step toward `side`'s base for a champion fleeing a tile it did not leave: along a lane to the next
 * position behind it (T1 → T2 → T3 → base), elsewhere to the neighbour closest to the base. Ties by id.
 */
export function retreatStep(data: GameData, side: Side, position: string): string {
  const { graph } = data;
  const base = `base-${side}`;
  const lane = graph.positions[position]?.lane;
  const options = (graph.adj[position] ?? []).filter(
    (n) => n !== enemyBase(side) && (lane === undefined || n === base || graph.positions[n]?.lane === lane),
  );
  const best = options.sort((a, b) => graph.distance(a, base) - graph.distance(b, base) || a.localeCompare(b))[0];
  return best !== undefined && graph.distance(best, base) < graph.distance(position, base) ? best : position;
}

const rank = (data: GameData, id: string): number => {
  const kind = data.graph.positions[id]?.kind;
  return kind === 'tower' || kind === 'laneMid' ? 0 : kind === 'camp' ? 1 : 2;
};

/**
 * The intermediate step of a 2-step move (undefined when `to` is not exactly 2 steps away). Among the valid
 * ones a lane position (tower, lane middle) beats a camp, which beats a river position (scuttle, pit); ties by id.
 */
export function bestVia(state: GameState, data: GameData, championId: string, to: string): string | undefined {
  const c = find(state, championId);
  const { graph } = data;
  if (graph.distance(c.position, to) !== 2) return undefined;
  return (graph.adj[c.position] ?? [])
    .filter((n) => n !== enemyBase(c.side) && graph.distance(n, to) === 1 && !isLaneChange(data, c.position, n))
    .sort((a, b) => rank(data, a) - rank(data, b) || a.localeCompare(b))[0];
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
    // The step before a recall is 1 move for everyone, never into the enemy base.
    if (o.to !== undefined && reachableFrom(data, c.position, 1, c.side)[o.to] === undefined) {
      fail(c.id, `recall step to ${o.to} is out of range`);
    }
    return;
  }

  const reach = reachable(state, data, c.id);
  if (reach[o.to] === undefined) fail(c.id, `cannot reach ${o.to}`);
  if (o.via !== undefined) {
    if (!graph.positions[o.via] || o.via === enemyBase(c.side)) fail(c.id, `invalid via ${o.via}`);
    if (o.via !== c.position && o.via !== o.to && isLaneChange(data, c.position, o.via)) {
      fail(c.id, `via ${o.via} changes lane, which ends the move`);
    }
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
 * A laner standing in its own lane follows the wave: to the wave position when reachable this round, else one
 * step along the lane toward it. Anywhere else (and for the jungler) the champion stays put.
 */
function followWave(state: GameState, data: GameData, c: ChampionState): string {
  if (c.role === 'jungle') return c.position;
  const lane = HOME_LANE[c.role];
  if (data.graph.positions[c.position]?.lane !== lane) return c.position;
  const target = wavePosition(state, data, lane);
  const reach = reachable(state, data, c.id);
  if (reach[target] !== undefined) return target;
  const inLane = Object.keys(reach).filter((p) => data.graph.positions[p]?.lane === lane);
  return inLane.sort(
    (a, b) => data.graph.distance(a, target) - data.graph.distance(b, target) || (a < b ? -1 : a > b ? 1 : 0),
  )[0]!;
}

/** Alive laners follow their wave, other alive champions stay put; respawning ones take their first spawn point. */
export function defaultOrders(state: GameState, data: GameData, side: Side): Order[] {
  const out: Order[] = [];
  for (const c of state.champions.filter((x) => x.side === side)) {
    if (c.status === 'alive') out.push({ kind: 'move', champion: c.id, to: followWave(state, data, c) });
    else if (c.status === 'respawning') {
      out.push({ kind: 'spawn', champion: c.id, to: spawnPoints(state, data, c.id)[0]! });
    }
  }
  return out;
}
