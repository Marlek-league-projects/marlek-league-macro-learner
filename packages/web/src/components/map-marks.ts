// Map geometry and timers, from the player's view only (fog of war holds).
import type { GameData, Lane, ObjectiveId, Position, Side } from '@lml/data/contracts';
import type { PlayerView } from '@lml/engine/contracts';
import { clock, OBJECTIVE_LABEL, pitObjectiveAt, SIDE_LABEL } from './format';

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

export interface PitTimer {
  /** "Larves 4:30" (what spawns next and the time left), or "Larves en vie" while it is up. */
  text: string;
  /** The objective is up. */
  live: boolean;
  /** While up: "part dans 7:30" when the objective leaves the pit at a set time (Larves, Héraut); otherwise null. */
  until: string | null;
  /** Longer text (SVG title). */
  title: string;
}

/**
 * The objective on `pit` during the round ending at `end`: the one up in the view, or the one spawning by the round's
 * end (objectives spawn at the start of the resolve, but the order phase already counts them up, as contacts do).
 */
export function pitObjectiveBy(view: PlayerView, data: GameData, pit: 'baron-pit' | 'dragon-pit', end: number): ObjectiveId | null {
  const state = view.pits[pit];
  if (state.objective) return state.objective;
  return state.nextSpawn !== null && state.nextSpawn <= end ? pitObjectiveAt(data, pit, state.nextSpawn) : null;
}

/** Rounds left before the capture in progress completes: it ends the round after it started. */
export function captureRoundsLeft(view: PlayerView, startedRound: number): number {
  return Math.max(1, startedRound + 2 - view.round);
}

/**
 * A pit's map label, named after its objective and counting the time left like every other map timer: before the
 * spawn, the next objective and the time left ("Larves 4:30", then "Héraut 12:30", then "Nashor 18:30" on the Baron
 * pit); while up, "<name> en vie" and, when it despawns, the time left before it does ("part dans 7:30"). Null when
 * the view shows no spawn to come. `end` is the round's end: an objective spawning by then is already "en vie". A
 * capture in progress (own, or the enemy's when seen) names who takes it and the rounds left ("Dragon — Bleu, 1 round
 * restant").
 */
export function pitTimer(view: PlayerView, data: GameData, pit: 'baron-pit' | 'dragon-pit', now: number, end: number = now): PitTimer | null {
  const state = view.pits[pit];
  const up = pitObjectiveBy(view, data, pit, end);
  if (up) {
    const name = OBJECTIVE_LABEL[up];
    const despawn = data.rules.objectives[up].despawnAt;
    const until = despawn === null ? null : `part dans ${clock(Math.max(0, despawn - now))}`;
    const capture = state.objective ? state.capture : null;
    if (capture) {
      const n = captureRoundsLeft(view, capture.startedRound);
      const text = `${name} — ${SIDE_LABEL[capture.side]}, ${n} round${n > 1 ? 's' : ''} restant${n > 1 ? 's' : ''}`;
      return { text, live: true, until, title: until ? `${text}, ${until}` : text };
    }
    return { text: `${name} en vie`, live: true, until, title: until ? `${name} en vie, ${until}` : `${name} en vie` };
  }
  if (state.nextSpawn === null) return null;
  const at = state.nextSpawn;
  const name = OBJECTIVE_LABEL[pitObjectiveAt(data, pit, at)];
  const left = Math.max(0, at - now);
  return { text: `${name} ${clock(left)}`, live: false, until: null, title: `${name} à ${clock(at)} (dans ${clock(left)})` };
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

/** An own champion's pending move: where it goes and whether it has a step left there to act (`canAct`). */
export interface PendingMove {
  to: string;
  acts: boolean;
}

/**
 * The objective prompt in the order phase: each own alive champion standing on a pit, or whose pending move ends on
 * one with a step left, when that pit's objective is up, being taken or spawning by the round's end (`end`), minus the
 * ones already answered (`closed`). A champion whose pending move leaves the pit, or with a pending recall
 * (`recalling`: "Faire" would replace it), is not offered it. Never for a champion on a Scuttle.
 */
export function objectivePromptEntries(
  view: PlayerView,
  data: GameData,
  window: { start: number; end: number },
  closed: readonly string[],
  moves: Readonly<Record<string, PendingMove>> = {},
  recalling: readonly string[] = [],
): ObjectivePromptEntry[] {
  const out: ObjectivePromptEntry[] = [];
  for (const c of view.allies) {
    if (c.status !== 'alive' || closed.includes(c.id) || recalling.includes(c.id)) continue;
    const move = moves[c.id];
    if (move && !move.acts) continue;
    const at = move ? move.to : c.position;
    if (at !== 'baron-pit' && at !== 'dragon-pit') continue;
    const objective = pitObjectiveBy(view, data, at, window.end);
    if (!objective) continue;
    out.push({ champion: c.id, pit: at, objective, withScuttle: view.scuttles[PIT_SCUTTLE[at]] <= window.end });
  }
  return out;
}
