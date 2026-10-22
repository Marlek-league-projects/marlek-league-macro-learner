import type { GameData, Lane, Rules, Side } from '@lml/data/contracts';
import type { ChampionState, EnemyInfo, GameEvent, GameState, PlayerView, Scoreboard, Ward } from './contracts';
import { level } from './economy';
import { estimateEnemy } from './estimate';
import { lanePressure } from './lanes';
import { route } from './movement';
import { SCUTTLE_PIT } from './objectives';

type ScuttleId = keyof GameState['scuttles'];

const LANES: Lane[] = ['top', 'mid', 'bot'];
const SIDES: Side[] = ['blue', 'red'];
const SCUTTLES: ScuttleId[] = ['scuttle-top', 'scuttle-bot'];

/**
 * A ward placed in round N gives vision while rounds N+1 … N+`wards.duration` resolve. A scuttle ward also sees the
 * end of the round it is taken in (it is put down during that resolution).
 */
function wardActive(w: Ward, round: number, rules: Rules): boolean {
  const started = w.placedRound < round || (w.scuttle === true && w.placedRound === round);
  return started && round <= w.placedRound + rules.wards.duration;
}

/**
 * Rounds of vision left to a ward, seen from `round` (the round being ordered or about to resolve), counting that
 * one: `wards.duration` for a ward placed this round or the last one, down to 1 on its last active round, 0 once spent.
 */
export function wardRoundsLeft(ward: Ward, round: number, rules: Rules): number {
  const { duration } = rules.wards;
  return Math.max(0, Math.min(duration, ward.placedRound + duration - round + 1));
}

/** Positions a ward sees: its own, plus the pit next to a scuttle ward. */
function wardSees(w: Ward): string[] {
  const pit = w.scuttle === true ? SCUTTLE_PIT[w.position as ScuttleId] : undefined;
  return pit ? [w.position, pit] : [w.position];
}

/** Positions of every lane holding one of `champions`, plus their own positions. */
function lanesAndPositions(data: GameData, champions: ChampionState[]): Set<string> {
  const seen = new Set<string>(champions.map((c) => c.position));
  for (const lane of LANES) {
    const positions = data.graph.lanePositions(lane);
    if (champions.some((c) => positions.includes(c.position))) for (const p of positions) seen.add(p);
  }
  return seen;
}

/** `side`'s wards giving vision while `state.round` resolves. */
function activeWards(state: GameState, data: GameData, side: Side): Ward[] {
  return state.wards.filter((w) => w.side === side && wardActive(w, state.round, data.rules));
}

/**
 * Positions `side` sees while `state.round` resolves: lanes holding an alive ally, allies' positions,
 * and what the side's active wards see.
 */
function seenPositions(state: GameState, data: GameData, side: Side): Set<string> {
  const seen = lanesAndPositions(data, state.champions.filter((c) => c.side === side && c.status === 'alive'));
  for (const w of activeWards(state, data, side)) for (const p of wardSees(w)) seen.add(p);
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
 * After the round's moves: every enemy whose routes this round (the order move, then any pull-in; both ends included)
 * cross what an active ward of `side` sees emits `wardSpotted` for `side`, once per champion and ward position. A
 * scuttle ward taken this round spots nothing yet. `to` is the enemy's `arrival` position (before any pull-in, flee or
 * retreat) when `side` sees that position at the end of the round, else null. Only moves spot: an enemy staying put
 * on a ward is simply seen.
 *
 * An enemy crossing a ward, or clearing one of `side`'s wards (`wardCleared`), is revealed to `side` for the round:
 * if not seen at the end, it is last seen `spotted` on the last warded position of its routes (or the cleared ward's
 * position), which the next view shows as visible with its level and HP, its moves staying hidden.
 */
export function spotByWards(state: GameState, data: GameData, events: GameEvent[], arrival: Readonly<Record<string, string>>): void {
  const moves = events.flatMap((e) => (e.type === 'moved' ? [e] : []));
  const out: GameEvent[] = [];
  for (const side of SIDES) {
    const wards = activeWards(state, data, side).filter((w) => w.placedRound < state.round);
    const visible = new Set(visibleEnemies(state, data, side));
    const seenAt = seenPositions(state, data, side);
    const spottedAt = new Map<string, string[]>();
    /** Enemy id to where `side` last saw it this round without seeing it at the end: a ward it crossed or cleared. */
    const lastWarded = new Map<string, string>();
    for (const e of events) if (e.type === 'wardCleared' && e.side === side) lastWarded.set(e.champion, e.position);
    for (const m of wards.length > 0 ? moves : []) {
      const c = state.champions.find((x) => x.id === m.champion)!;
      if (c.side === side) continue;
      // A spawn appears on its spawn point: only that point can be warded.
      const path = m.from === `base-${c.side}` ? [m.to] : route(data, m.from, m.to, c.side);
      const at = spottedAt.get(c.id) ?? [];
      for (const p of path) {
        for (const w of wards) {
          if (!wardSees(w).includes(p)) continue;
          if (!at.includes(w.position)) at.push(w.position);
          lastWarded.set(c.id, p);
        }
      }
      spottedAt.set(c.id, at);
    }
    for (const [id, at] of spottedAt) {
      const to = arrival[id] !== undefined && seenAt.has(arrival[id]) ? arrival[id] : null;
      for (const position of at) out.push({ type: 'wardSpotted', side, position, champion: id, to });
    }
    for (const [id, last] of lastWarded) {
      const c = state.champions.find((x) => x.id === id)!;
      if (!visible.has(id) && c.status === 'alive') {
        state.lastSeen[side][id] = { position: last, round: state.round, spotted: true };
      }
    }
  }
  events.push(...out);
}

/**
 * End of round: records the enemies, scuttle and camp timers each side sees, then drops wards whose
 * vision is spent.
 */
export function updateVision(state: GameState, data: GameData): void {
  const wardSight: Record<Side, string[]> = { blue: [], red: [] };
  for (const side of SIDES) {
    wardSight[side] = [...new Set(activeWards(state, data, side).flatMap(wardSees))];
    for (const id of visibleEnemies(state, data, side)) {
      const c = state.champions.find((x) => x.id === id)!;
      state.lastSeen[side][id] = { position: c.position, round: state.round };
    }
    const seen = seenPositions(state, data, side);
    for (const id of SCUTTLES) if (seen.has(id)) state.scuttlesSeen[side][id] = state.scuttles[id];
    for (const [id, t] of Object.entries(state.camps)) if (seen.has(id)) state.campsSeen[side][id] = t;
  }
  state.wardSight = wardSight;
  state.wards = state.wards.filter((w) => w.placedRound + data.rules.wards.duration > state.round);
}

/**
 * Enemy id to position, for enemies `side` saw at the end of the previous round; with `spotted`, also those only seen
 * passing or clearing an own ward that round (at that ward).
 */
function seenLastRound(state: GameState, side: Side, spotted = false): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of state.champions) {
    const last = state.lastSeen[side][c.id];
    if (c.side !== side && c.status === 'alive' && last && last.round === state.round - 1 && (spotted || !last.spotted)) {
      out.set(c.id, last.position);
    }
  }
  return out;
}

/**
 * What `side` knows at the start of `state.round`. Fog of war:
 * - enemies seen when the previous round resolved show where they are, with their level and HP; an enemy that round
 *   only seen passing or clearing an own ward shows the same, at that ward; the others their last seen position;
 * - an enemy pit capture shows only if an enemy was seen on that pit;
 * - scuttle timers are the side's last seen ones, so an unseen enemy take leaves the scuttle shown as before;
 * - camp timers likewise, own and enemy (seen with an own champion or active ward on the camp, or cleared by the
 *   side), so an unseen enemy clear or invade leaves the timer shown as before.
 */
export function viewFor(state: GameState, data: GameData, side: Side): PlayerView {
  const visible = seenLastRound(state, side, true);
  const atEnd = seenLastRound(state, side);
  const enemies: EnemyInfo[] = state.champions
    .filter((c) => c.side !== side)
    .map((c) => {
      const last = state.lastSeen[side][c.id] ?? null;
      const seen = visible.has(c.id);
      const met = state.met?.[side][c.id];
      return {
        id: c.id,
        role: c.role,
        visible: seen,
        position: last?.position ?? null,
        lastSeenRound: last?.round ?? null,
        level: seen ? level(c.xp, data.rules) : null,
        hp: seen ? c.hp : null,
        met: !seen && met && (!last || last.round <= met.round) ? { ...met } : null,
      };
    });
  const camps: GameState['camps'] = { ...state.campsSeen[side] };
  const s = structuredClone(state);
  const enemyOn = new Set(atEnd.values());
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
    pressure: pressureSeen(s, data, side, enemies),
  };
}

/**
 * Lane pressure as `side` may know it: its own champions as they are, the enemies it sees with the stats it would
 * estimate for them (never their true lead or items). An unseen side gives null.
 */
function pressureSeen(s: GameState, data: GameData, side: Side, enemies: EnemyInfo[]): Record<Lane, Side | null> {
  const known = { side, allies: s.champions.filter((c) => c.side === side), objectivesTaken: s.objectivesTaken, scoreboard: scoreboard(s) };
  const champions = s.champions.flatMap((c) => {
    if (c.side === side) return [c];
    const e = enemies.find((x) => x.id === c.id)!;
    return e.visible ? [{ ...c, ...estimateEnemy(known, data, e) }] : [];
  });
  const seen = { ...s, champions };
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
    heralds: perSide((side) => s.objectivesTaken[side].herald ?? 0),
    voidgrubs: perSide((side) => s.objectivesTaken[side].voidgrubs ?? 0),
    plates: { ...s.platesTaken },
    goldEarned: perSide((side) => s.champions.reduce((t, c) => (c.side === side ? t + c.goldEarned : t), 0)),
  };
}

/**
 * The round's events `side` may know about, given the state `after` the round. Own-side events are kept;
 * enemy ones only where `side` saw them: the enemy was visible at the resolution (not only spotted passing a ward), or
 * the event's position is in a lane holding an own alive champion, holds one, holds an own champion killed this
 * round, holds a visible enemy, or is seen by an own ward active that round (`wardSight`). An enemy recall shows where
 * it happens (`position`); a cleared ward shows to its owner and to the clearer's side. Contacts (fight, trade,
 * death) always involve both sides, and waves, tower damage, herald launches and taken objectives other than the
 * scuttle are public. HP losses show for own champions and
 * enemies visible after the round.
 */
export function eventsFor(events: GameEvent[], after: GameState, data: GameData, side: Side): GameEvent[] {
  const byId = new Map(after.champions.map((c) => [c.id, c]));
  const own = (id: string): boolean => byId.get(id)?.side === side;
  const visible = seenLastRound(after, side);
  const killed = new Set(events.flatMap((e) => (e.type === 'death' ? [e.champion] : [])));
  const watchers = after.champions.filter((c) => c.side === side && (c.status === 'alive' || killed.has(c.id)));
  const seen = lanesAndPositions(data, watchers);
  for (const p of visible.values()) seen.add(p);
  for (const p of after.wardSight?.[side] ?? []) seen.add(p);
  const enemySeen = (id: string): boolean => own(id) || visible.has(id);
  const movedTo = new Map(events.flatMap((e) => (e.type === 'moved' ? [[e.champion, e.to] as const] : [])));

  const shown = events.filter((e) => {
    switch (e.type) {
      case 'fight':
      case 'joined':
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
        return enemySeen(e.champion) || seen.has(e.position);
      case 'objectiveStarted':
        return e.side === side || seen.has(e.position);
      case 'campCleared':
        return own(e.champion) || seen.has(e.camp);
      case 'wardPlaced':
        return e.side === side || seen.has(e.position);
      case 'wardCleared':
        return e.side === side || own(e.champion) || seen.has(e.position);
      case 'wardSpotted':
        return e.side === side;
      case 'hpLost':
        return enemySeen(e.champion);
    }
  });
  // A joiner is seen in the contact, but where it came from only when the side sees that position.
  // Its own move onto that origin is hidden too: the side only learns that it joined.
  const maskedJoin = new Map(
    shown.flatMap((e) => (e.type === 'joined' && e.from !== null && !own(e.champion) && !seen.has(e.from) ? [[e.champion, e.from] as const] : [])),
  );
  return shown
    .filter((e) => !(e.type === 'moved' && maskedJoin.get(e.champion) === e.to))
    .map((e) => (e.type === 'joined' && e.from !== null && !own(e.champion) && !seen.has(e.from) ? { ...e, from: null } : e));
}
