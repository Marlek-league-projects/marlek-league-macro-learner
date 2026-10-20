import type { GameData, Lane, Side } from '@lml/data/contracts';
import type { ChampionState, EnemyInfo, GameEvent, GameState, PlayerView, Scoreboard } from './contracts';
import { level } from './economy';
import { lanePressure } from './lanes';

type ScuttleId = keyof GameState['scuttles'];

const LANES: Lane[] = ['top', 'mid', 'bot'];
const SIDES: Side[] = ['blue', 'red'];
const SCUTTLES: ScuttleId[] = ['scuttle-top', 'scuttle-bot'];

/** Positions of every lane holding one of `champions`, plus their own positions. */
function lanesAndPositions(data: GameData, champions: ChampionState[]): Set<string> {
  const seen = new Set<string>(champions.map((c) => c.position));
  for (const lane of LANES) {
    const positions = data.graph.lanePositions(lane);
    if (champions.some((c) => positions.includes(c.position))) for (const p of positions) seen.add(p);
  }
  return seen;
}

/**
 * Positions `side` sees while `state.round` resolves: lanes holding an alive ally, allies' positions,
 * and the side's active wards (placed last round, or a scuttle ward placed this round).
 */
function seenPositions(state: GameState, data: GameData, side: Side): Set<string> {
  const seen = lanesAndPositions(data, state.champions.filter((c) => c.side === side && c.status === 'alive'));
  for (const w of state.wards) {
    const active = w.placedRound === state.round - 1 || (w.scuttle === true && w.placedRound === state.round);
    if (w.side === side && active) seen.add(w.position);
  }
  return seen;
}

/** Alive enemies `side` sees while `state.round` resolves. */
export function visibleEnemies(state: GameState, data: GameData, side: Side): string[] {
  const seen = seenPositions(state, data, side);
  return state.champions
    .filter((c) => c.side !== side && c.status === 'alive' && seen.has(c.position))
    .map((c) => c.id);
}

/**
 * End of round: records the enemies, scuttle and camp timers each side sees, then drops wards whose
 * vision is spent.
 */
export function updateVision(state: GameState, data: GameData): void {
  for (const side of SIDES) {
    for (const id of visibleEnemies(state, data, side)) {
      const c = state.champions.find((x) => x.id === id)!;
      state.lastSeen[side][id] = { position: c.position, round: state.round };
    }
    const seen = seenPositions(state, data, side);
    for (const id of SCUTTLES) if (seen.has(id)) state.scuttlesSeen[side][id] = state.scuttles[id];
    for (const [id, t] of Object.entries(state.camps)) if (seen.has(id)) state.campsSeen[side][id] = t;
  }
  state.wards = state.wards.filter((w) => w.placedRound >= state.round);
}

/** Enemy id to position, for enemies `side` saw when the previous round resolved. */
function seenLastRound(state: GameState, side: Side): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of state.champions) {
    const last = state.lastSeen[side][c.id];
    if (c.side !== side && c.status === 'alive' && last && last.round === state.round - 1) out.set(c.id, last.position);
  }
  return out;
}

/**
 * What `side` knows at the start of `state.round`. Fog of war:
 * - enemies seen when the previous round resolved show where they are, the others their last seen position;
 * - an enemy pit capture shows only if an enemy was seen on that pit;
 * - scuttle timers are the side's last seen ones, so an unseen enemy take leaves the scuttle shown as before;
 * - own camp timers likewise (seen with an own champion or active ward on the camp, or cleared by the side).
 */
export function viewFor(state: GameState, data: GameData, side: Side): PlayerView {
  const visible = seenLastRound(state, side);
  const enemies: EnemyInfo[] = state.champions
    .filter((c) => c.side !== side)
    .map((c) => {
      const last = state.lastSeen[side][c.id] ?? null;
      const seen = visible.has(c.id);
      return {
        id: c.id,
        role: c.role,
        visible: seen,
        position: last?.position ?? null,
        lastSeenRound: last?.round ?? null,
        level: seen ? level(c.xp, data.rules) : null,
      };
    });
  const camps: GameState['camps'] = {};
  for (const [id, t] of Object.entries(state.campsSeen[side])) {
    if (data.graph.positions[id]?.side === side) camps[id] = t;
  }
  const s = structuredClone(state);
  const enemyOn = new Set(visible.values());
  for (const [id, pit] of Object.entries(s.pits)) {
    if (pit.capture && pit.capture.side !== side && !enemyOn.has(id)) pit.capture = null;
  }
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
    scuttles: s.scuttlesSeen[side],
    camps,
    wards: s.wards.filter((w) => w.side === side),
    grubs: s.grubs,
    baronUntilRound: s.baronUntilRound,
    objectivesTaken: s.objectivesTaken,
    platesTaken: s.platesTaken,
    towersDestroyed: s.towersDestroyed,
    scoreboard: scoreboard(s),
    pressure: pressureSeen(s, data, side, visible),
  };
}

/** Lane pressure among `side`'s champions and the enemies it sees (`visible`); an unseen side gives null. */
function pressureSeen(s: GameState, data: GameData, side: Side, visible: Map<string, string>): Record<Lane, Side | null> {
  const seen = { ...s, champions: s.champions.filter((c) => c.side === side || visible.has(c.id)) };
  const out = {} as Record<Lane, Side | null>;
  for (const lane of LANES) out[lane] = lanePressure(seen, data, lane);
  return out;
}

function scoreboard(s: GameState): Scoreboard {
  const perSide = (f: (side: Side) => number): Record<Side, number> => ({ blue: f('blue'), red: f('red') });
  return {
    kills: { ...s.kills },
    towersDestroyed: { ...s.towersDestroyed },
    dragons: perSide((side) => s.objectivesTaken[side].dragon ?? 0),
    barons: perSide((side) => s.objectivesTaken[side].baron ?? 0),
    goldEarned: perSide((side) => s.champions.reduce((t, c) => (c.side === side ? t + c.goldEarned : t), 0)),
  };
}

/**
 * The round's events `side` may know about, given the state `after` the round. Own-side events are kept;
 * enemy ones only where `side` saw them: the enemy was visible at the resolution, or the event's position
 * is in a lane holding an own alive champion, holds one, holds an own champion killed this round, or holds
 * a visible enemy. Contacts (fight, trade, death) always involve both sides, and waves, tower damage,
 * herald launches and taken objectives other than the scuttle are public.
 */
export function eventsFor(events: GameEvent[], after: GameState, data: GameData, side: Side): GameEvent[] {
  const byId = new Map(after.champions.map((c) => [c.id, c]));
  const own = (id: string): boolean => byId.get(id)?.side === side;
  const visible = seenLastRound(after, side);
  const killed = new Set(events.flatMap((e) => (e.type === 'death' ? [e.champion] : [])));
  const watchers = after.champions.filter((c) => c.side === side && (c.status === 'alive' || killed.has(c.id)));
  const seen = lanesAndPositions(data, watchers);
  for (const p of visible.values()) seen.add(p);
  const enemySeen = (id: string): boolean => own(id) || visible.has(id);
  const movedTo = new Map(events.flatMap((e) => (e.type === 'moved' ? [[e.champion, e.to] as const] : [])));

  return events.filter((e) => {
    switch (e.type) {
      case 'fight':
      case 'trade':
      case 'death':
      case 'wave':
      case 'towerDamage':
      case 'heraldLaunched':
        return true;
      case 'objectiveTaken':
        // Epic objectives are announced to everyone; a scuttle take is not.
        return e.objective !== 'scuttle' || e.side === side || seen.has(e.position);
      case 'moved':
        return enemySeen(e.champion) || seen.has(e.to);
      case 'fled':
        return enemySeen(e.champion) || seen.has(e.to) || seen.has(movedTo.get(e.champion) ?? '');
      case 'recall':
        return enemySeen(e.champion) || seen.has(byId.get(e.champion)?.position ?? '');
      case 'objectiveStarted':
        return e.side === side || seen.has(e.position);
      case 'campCleared':
        return own(e.champion) || seen.has(e.camp);
      case 'wardPlaced':
      case 'wardCleared':
        return e.side === side || seen.has(e.position);
    }
  });
}
