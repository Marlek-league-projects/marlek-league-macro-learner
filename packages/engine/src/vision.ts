import type { GameData, Lane, Side } from '@lml/data/contracts';
import type { EnemyInfo, GameState, PlayerView } from './contracts';
import { level } from './economy';

const LANES: Lane[] = ['top', 'mid', 'bot'];
const SIDES: Side[] = ['blue', 'red'];

/**
 * Alive enemies `side` sees while `state.round` resolves: in a lane holding an ally, on an ally's
 * position, or on a position with one of the side's active wards (placed last round, or a scuttle
 * ward placed this round).
 */
export function visibleEnemies(state: GameState, data: GameData, side: Side): string[] {
  const allies = state.champions.filter((c) => c.side === side && c.status === 'alive');
  const seen = new Set<string>(allies.map((c) => c.position));
  for (const lane of LANES) {
    const positions = data.graph.lanePositions(lane);
    if (allies.some((c) => positions.includes(c.position))) for (const p of positions) seen.add(p);
  }
  for (const w of state.wards) {
    const active = w.placedRound === state.round - 1 || (w.scuttle === true && w.placedRound === state.round);
    if (w.side === side && active) seen.add(w.position);
  }
  return state.champions
    .filter((c) => c.side !== side && c.status === 'alive' && seen.has(c.position))
    .map((c) => c.id);
}

/** End of round: records what each side sees, then drops wards whose vision is spent. */
export function updateVision(state: GameState, data: GameData): void {
  for (const side of SIDES) {
    for (const id of visibleEnemies(state, data, side)) {
      const c = state.champions.find((x) => x.id === id)!;
      state.lastSeen[side][id] = { position: c.position, round: state.round };
    }
  }
  state.wards = state.wards.filter((w) => w.placedRound >= state.round);
}

/**
 * What `side` knows at the start of `state.round`: enemies seen when the previous round resolved
 * show where they are, the others only their last seen position.
 */
export function viewFor(state: GameState, data: GameData, side: Side): PlayerView {
  const enemies: EnemyInfo[] = state.champions
    .filter((c) => c.side !== side)
    .map((c) => {
      const last = state.lastSeen[side][c.id] ?? null;
      const visible = c.status === 'alive' && last !== null && last.round === state.round - 1;
      return {
        id: c.id,
        role: c.role,
        visible,
        position: visible ? c.position : (last?.position ?? null),
        lastSeenRound: last?.round ?? null,
        level: visible ? level(c.xp, data.rules) : null,
      };
    });
  const camps: GameState['camps'] = {};
  for (const [id, t] of Object.entries(state.camps)) {
    if (data.graph.positions[id]?.side === side) camps[id] = t;
  }
  const s = structuredClone(state);
  return {
    side,
    round: s.round,
    over: s.over,
    winner: s.winner,
    allies: s.champions.filter((c) => c.side === side),
    enemies,
    towers: s.towers,
    waves: s.waves,
    pits: s.pits,
    scuttles: s.scuttles,
    camps,
    wards: s.wards.filter((w) => w.side === side),
    grubs: s.grubs,
    baronUntilRound: s.baronUntilRound,
    objectivesTaken: s.objectivesTaken,
    platesTaken: s.platesTaken,
    towersDestroyed: s.towersDestroyed,
  };
}
