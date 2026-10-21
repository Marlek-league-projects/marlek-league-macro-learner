// Map geometry and timers, from the player's view only (fog of war holds).
import type { GameData, Lane, ObjectiveId, Position, Side } from '@lml/data/contracts';
import type { PlayerView } from '@lml/engine/contracts';

export interface Point {
  x: number;
  y: number;
}

/** Seconds left before the position's objective or camp is up, `'up'` when it is, null when the view says nothing. */
export function spawnCountdown(view: PlayerView, data: GameData, id: string, now: number): number | 'up' | null {
  const p = data.graph.positions[id];
  if (!p) return null;
  const left = (at: number) => (at > now ? at - now : 'up');
  if (id === 'baron-pit' || id === 'dragon-pit') {
    const pit = view.pits[id];
    if (pit.objective) return 'up';
    return pit.nextSpawn === null ? null : left(pit.nextSpawn);
  }
  if (id === 'scuttle-top' || id === 'scuttle-bot') return left(view.scuttles[id]);
  if (p.kind === 'camp') {
    const at = view.camps[id];
    return at === undefined ? null : left(at);
  }
  return null;
}

/** Gap between the centres of tokens standing side by side on one position (room for their HUDs). */
export const PAWN_SPREAD = 48;

/** How far from a front tower toward the lane middle a wave pushed to that tower is drawn. */
export const WAVE_NEAR_TOWER = 0.3;

function laneMiddle(data: GameData, lane: Lane): Position {
  const p = Object.values(data.graph.positions).find((x) => x.kind === 'laneMid' && x.lane === lane);
  if (!p) throw new Error(`no lane middle for ${lane}`);
  return p;
}

/** The side's lowest-tier standing tower in the lane, or its base when the lane is open. */
function front(view: PlayerView, data: GameData, side: Side, lane: Lane): Position {
  const id = data.graph.towers(side, lane).find((t) => (view.towers[t] ?? 0) > 0) ?? `base-${side}`;
  return data.graph.positions[id]!;
}

/** Where the lane's wave marker goes: by the blue front tower, on the lane middle, or by the red front tower. */
export function wavePoint(view: PlayerView, data: GameData, lane: Lane): Point {
  const mid = laneMiddle(data, lane);
  const wave = view.waves[lane];
  if (wave === 0) return { x: mid.x, y: mid.y };
  const t = front(view, data, wave < 0 ? 'blue' : 'red', lane);
  return { x: t.x + (mid.x - t.x) * WAVE_NEAR_TOWER, y: t.y + (mid.y - t.y) * WAVE_NEAR_TOWER };
}

/** Radius of a position's dot. */
export function dotRadius(p: Position): number {
  if (p.kind === 'base') return 18;
  return p.kind === 'pit' ? 12 : 8;
}

/** Radius of a position's invisible click circle: twice its dot (bases are already large). */
export function hitRadius(p: Position): number {
  return p.kind === 'base' ? dotRadius(p) : 2 * dotRadius(p);
}

/** Unit vector along the lane pointing the way `side` pushes it (blue pushes toward red's towers). */
export function pressureDirection(data: GameData, lane: Lane, side: Side): Point {
  const from = data.graph.positions[data.graph.towers('blue', lane)[0]!]!;
  const to = data.graph.positions[data.graph.towers('red', lane)[0]!]!;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const sign = side === 'blue' ? 1 : -1;
  return { x: (sign * dx) / len, y: (sign * dy) / len };
}

/** How a position lights up for the selected token: it can act there, only arrive there, or it is out of reach. */
export type RangeRing = 'act' | 'arrive' | null;

/** `distance` from `reachable` (undefined: out of reach); `canAct` is the engine's rule for this round's budget. */
export function rangeRing(distance: number | undefined, canAct: (distance: number) => boolean): RangeRing {
  if (distance === undefined) return null;
  return canAct(distance) ? 'act' : 'arrive';
}

export const ARRIVAL_ONLY_TIP = "Arrivée seulement : pas d'action ce tour";

const PIT_SCUTTLE: Record<'baron-pit' | 'dragon-pit', 'scuttle-top' | 'scuttle-bot'> = {
  'baron-pit': 'scuttle-top',
  'dragon-pit': 'scuttle-bot',
};

export interface ObjectivePromptEntry {
  champion: string;
  pit: 'baron-pit' | 'dragon-pit';
  objective: ObjectiveId;
  /** The river's Scuttle is up too: doing the objective takes it in the same round. */
  withScuttle: boolean;
}

/**
 * The objective prompt at the start of the order phase: each own alive champion standing on a pit whose objective
 * is up or being taken, minus the ones already answered (`closed`). Never for a champion on a Scuttle.
 */
export function objectivePromptEntries(view: PlayerView, now: number, closed: readonly string[]): ObjectivePromptEntry[] {
  const out: ObjectivePromptEntry[] = [];
  for (const c of view.allies) {
    if (c.status !== 'alive' || closed.includes(c.id)) continue;
    if (c.position !== 'baron-pit' && c.position !== 'dragon-pit') continue;
    const objective = view.pits[c.position].objective;
    if (!objective) continue;
    out.push({ champion: c.id, pit: c.position, objective, withScuttle: view.scuttles[PIT_SCUTTLE[c.position]] <= now });
  }
  return out;
}
