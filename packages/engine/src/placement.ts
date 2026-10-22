// Round 0 placement: before round 1 (0:00 → 0:55) each side puts its champions on its own side or a lane middle.
import type { GameData, Role, Side } from '@lml/data/contracts';
import type { GameState, PlayerView } from './contracts';

const HOME_LANE: Record<Exclude<Role, 'jungle'>, string> = { top: 'top', mid: 'mid', adc: 'bot', support: 'bot' };

/** The default (and the AI's) start of a laner: its own T1 in its home lane. */
export function laneStart(side: Side, role: Exclude<Role, 'jungle'>): string {
  return `${HOME_LANE[role]}-t1-${side}`;
}

/**
 * Positions a `side` champion may start on: every position of its own side (towers, camps, base) and the lane
 * middles. The river (Scuttles, pits) and the enemy side are not allowed. In map order.
 */
export function placementPositions(data: GameData, side: Side): string[] {
  return Object.values(data.graph.positions)
    .filter((p) => p.side === side || p.kind === 'laneMid')
    .map((p) => p.id);
}

/**
 * Round 0: puts `side`'s champions on their start positions (`placements`: champion id → position id; champions left
 * out stay where they are; several may share a position). Only before round 1 resolves. Nothing resolves (no contact,
 * no farm, no camp): only the positions change, and the enemy's round-1 sighting of a placed jungler follows it (the
 * enemy jungler's start is seen in round 1). Throws on a champion not of `side` or a position not allowed.
 */
export function placeChampions(state: GameState, data: GameData, side: Side, placements: Record<string, string>): GameState {
  if (state.round !== 1) throw new Error(`placement only before round 1 (round ${state.round})`);
  const allowed = new Set(placementPositions(data, side));
  const s = structuredClone(state);
  const enemy: Side = side === 'blue' ? 'red' : 'blue';
  for (const [id, to] of Object.entries(placements)) {
    const c = s.champions.find((x) => x.id === id);
    if (!c || c.side !== side) throw new Error(`${id}: not a ${side} champion`);
    if (!allowed.has(to)) throw new Error(`${id}: cannot start on ${to}`);
    c.position = to;
    c.previous = to;
    if (c.role === 'jungle') s.lastSeen[enemy][c.id] = { position: to, round: 0 };
  }
  return s;
}

/** The AI's round 0 placement, from its view: laners on their own T1, the jungler on its seeded buff (where it stands). */
export function aiPlacements(view: PlayerView, data: GameData): Record<string, string> {
  const allowed = new Set(placementPositions(data, view.side));
  const out: Record<string, string> = {};
  for (const c of view.allies) {
    if (c.role !== 'jungle') out[c.id] = laneStart(view.side, c.role);
    else out[c.id] = allowed.has(c.position) && data.graph.positions[c.position]?.kind === 'camp' ? c.position : `bluebuff-${view.side}`;
  }
  return out;
}
