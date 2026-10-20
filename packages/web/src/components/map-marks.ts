// Map geometry and timers, from the player's view only (fog of war holds).
import type { GameData, Lane, Position, Side } from '@lml/data/contracts';
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

/** Smallest strength bar fill, so the weakest visible pawn still shows a sliver. */
export const MIN_STRENGTH_FILL = 0.08;

/** Bar fill (0..1) of a pawn of strength `strength` next to the strongest visible one. */
export function strengthFill(strength: number, strongest: number): number {
  if (strongest <= 0) return 1;
  return Math.min(1, Math.max(MIN_STRENGTH_FILL, strength / strongest));
}

/**
 * Strength bar fill of every pawn on the map, keyed by champion id: the xp its level needs plus its lead
 * (fight score units). Allies use their own gold earned and bonus lead. A visible enemy only shows its
 * level, so its lead is its team's average gold earned (public, the scoreboard) plus its side's Dragons.
 */
export function strengthFills(view: PlayerView, data: GameData, level: (xp: number) => number): Record<string, number> {
  const { levelXp } = data.rules.economy;
  const enemy: Side = view.side === 'blue' ? 'red' : 'blue';
  const floor = (lvl: number) => levelXp[lvl - 1] ?? 0;
  const strengths: Record<string, number> = {};
  for (const c of view.allies) {
    if (c.status === 'dead') continue;
    strengths[c.id] = floor(level(c.xp)) + c.goldEarned + c.bonusLead;
  }
  const enemyLead = view.scoreboard.goldEarned[enemy] / Math.max(1, view.enemies.length)
    + (view.objectivesTaken[enemy].dragon ?? 0) * data.rules.buffs.dragonLead;
  for (const e of view.enemies) {
    if (!e.visible || !e.position || e.level === null) continue;
    strengths[e.id] = floor(e.level) + enemyLead;
  }
  const strongest = Math.max(0, ...Object.values(strengths));
  return Object.fromEntries(Object.entries(strengths).map(([id, s]) => [id, strengthFill(s, strongest)]));
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
