import type { GameData, ObjectiveId, Side } from '@lml/data/contracts';
import type { ChampionState, GameEvent, GameState, Orders, PitState } from './contracts';
import { lead } from './fight';
import { damageTower, grant } from './lanes';
import { roundWindow } from './time';

export type PitId = keyof GameState['pits'];
type ScuttleId = keyof GameState['scuttles'];

const SIDES: Side[] = ['blue', 'red'];
const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');
/** Objectives each pit hosts, in the order they replace each other. */
const PIT_SEQUENCE: Record<PitId, ObjectiveId[]> = {
  'dragon-pit': ['dragon'],
  'baron-pit': ['voidgrubs', 'herald', 'baron'],
};
/** Pit next to each scuttle, which the scuttle's ward also sees. */
export const SCUTTLE_PIT: Record<ScuttleId, PitId> = { 'scuttle-top': 'baron-pit', 'scuttle-bot': 'dragon-pit' };
const BUFF_CAMPS = new Set(['bluebuff', 'redbuff']);

/** Objective of `pit` alive at time `t`: the first in its sequence not yet despawned. */
export function objectiveAt(data: GameData, pit: PitId, t: number): ObjectiveId {
  const seq = PIT_SEQUENCE[pit];
  return seq.find((id) => {
    const despawn = data.rules.objectives[id].despawnAt;
    return despawn === null || despawn > t;
  }) ?? seq[seq.length - 1]!;
}

/**
 * Round start: activates pit objectives whose spawn time falls before the end of the round,
 * despawns timed-out ones (voidgrubs → herald → baron).
 */
export function spawnObjectives(state: GameState, data: GameData): void {
  const end = roundWindow(data.rules, state.round).end;
  for (const id of Object.keys(PIT_SEQUENCE) as PitId[]) {
    const pit = state.pits[id];
    // Loop so that a state jumping several timers ahead settles on the current objective. Each objective spawns
    // and despawns at most once per call; more means the data never settles (last objective must not despawn).
    const maxSteps = 2 * PIT_SEQUENCE[id].length;
    for (let steps = 0; ; steps++) {
      if (steps > maxSteps) throw new Error(`${id}: objective timers never settle (does the last objective despawn?)`);
      if (pit.objective === null && pit.nextSpawn !== null && pit.nextSpawn <= end) {
        pit.objective = objectiveAt(data, id, pit.nextSpawn);
        pit.nextSpawn = null;
        pit.capture = null;
        continue;
      }
      const despawn = pit.objective ? data.rules.objectives[pit.objective].despawnAt : null;
      if (despawn !== null && despawn <= end) {
        pit.objective = null;
        pit.nextSpawn = despawn;
        pit.capture = null;
        continue;
      }
      break;
    }
  }
}

/** Alive champions standing on `position`, grouped by side. */
function presentAt(state: GameState, position: string): Record<Side, ChampionState[]> {
  const here = state.champions.filter((c) => c.status === 'alive' && c.position === position);
  return { blue: here.filter((c) => c.side === 'blue'), red: here.filter((c) => c.side === 'red') };
}

function reward(state: GameState, data: GameData, objective: ObjectiveId, side: Side, takers: ChampionState[]): void {
  const { buffs, objectives } = data.rules;
  const rule = objectives[objective];
  for (const c of takers) grant(c, rule.gold / takers.length, rule.xp / takers.length);
  const taken = state.objectivesTaken[side];
  taken[objective] = (taken[objective] ?? 0) + 1;
  switch (objective) {
    case 'dragon':
      for (const c of state.champions) if (c.side === side) c.bonusLead += buffs.dragonLead;
      break;
    case 'voidgrubs':
      state.grubs[side] = true;
      break;
    case 'herald': {
      const carrier = [...takers].sort((a, b) => lead(b, data.rules) - lead(a, data.rules) || a.id.localeCompare(b.id))[0]!;
      carrier.hasHerald = true;
      break;
    }
    case 'baron':
      state.baronUntilRound[side] = state.round + buffs.baronRounds - 1;
      break;
    case 'scuttle':
      break;
  }
}

function takePit(state: GameState, data: GameData, id: PitId, pit: PitState, side: Side, takers: ChampionState[], events: GameEvent[]): void {
  const objective = pit.objective!;
  const rule = data.rules.objectives[objective];
  reward(state, data, objective, side, takers);
  events.push({ type: 'objectiveTaken', objective, side, position: id, champions: takers.map((c) => c.id) });
  pit.objective = null;
  pit.capture = null;
  // Respawning objectives come back after `respawn`; the others leave the pit to the next one in line.
  pit.nextSpawn = rule.respawn !== null ? roundWindow(data.rules, state.round).end + rule.respawn : rule.despawnAt;
}

/** The Scuttle of each pit's river. */
const PIT_SCUTTLE: Record<PitId, ScuttleId> = { 'baron-pit': 'scuttle-top', 'dragon-pit': 'scuttle-bot' };

function takeScuttle(state: GameState, data: GameData, id: ScuttleId, side: Side, takers: ChampionState[], events: GameEvent[]): void {
  const end = roundWindow(data.rules, state.round).end;
  reward(state, data, 'scuttle', side, takers);
  state.scuttles[id] = end + (data.rules.objectives.scuttle.respawn ?? Infinity);
  // The scuttle ward sits on the scuttle; it replaces only this side's previous scuttle ward there.
  state.wards = state.wards.filter((w) => !(w.scuttle && w.side === side && w.position === id));
  state.wards.push({ side, position: id, placedRound: state.round, scuttle: true });
  events.push({ type: 'objectiveTaken', objective: 'scuttle', side, position: id, champions: takers.map((c) => c.id) });
}

/**
 * End of round, after contacts (flees, retreats and deaths applied): pit objectives started, captured or their capture
 * reset, then scuttles taken. Only `acting` champions (a step left on arrival) act; on a pit, only those also in
 * `pitActing` (default: all of `acting`; a side in a contested river must have chosen to keep on the objective).
 * - A pit progresses for the side with at least `minChampions` such champions on it, more than every alive enemy still
 *   on the pit (acting or not): an uncontested side, or one with the numbers. The same side progressing 2 rounds in a
 *   row takes it at the end of the 2nd (in one round with `instantAt` champions, or with no `extraRound`). Equal
 *   numbers, too few champions or nobody: the capture resets.
 * - Taking the pit objective also takes the river's Scuttle if it is up and no enemy is in the river (shared by the
 *   same takers).
 * - A Scuttle is contested by any alive enemy in its river (the pit or the Scuttle); otherwise the champions on it
 *   take only the Scuttle, never the pit objective.
 */
export function captureObjectives(
  state: GameState,
  data: GameData,
  events: GameEvent[],
  acting: ReadonlySet<string>,
  pitActing: ReadonlySet<string> = acting,
): void {
  const { rules } = data;
  const end = roundWindow(rules, state.round).end;
  const scuttleUp = (id: ScuttleId): boolean => state.scuttles[id] <= end;
  /** Sides with alive champions in the river of `pit` (the pit and its Scuttle). */
  const riverSides = (pit: PitId): Side[] => {
    const inPit = presentAt(state, pit);
    const onScuttle = presentAt(state, PIT_SCUTTLE[pit]);
    return SIDES.filter((s) => inPit[s].length + onScuttle[s].length > 0);
  };
  /** The only side present in the river of `pit`, with at least `min` `acting` champions on `position`: those take it. */
  const scuttleTakers = (pit: PitId, position: string, min: number): { side: Side; takers: ChampionState[] } | null => {
    const sides = riverSides(pit);
    if (sides.length !== 1) return null;
    const side = sides[0]!;
    const takers = presentAt(state, position)[side].filter((c) => acting.has(c.id));
    return takers.length >= min ? { side, takers } : null;
  };
  /** The side with at least `min` `pitActing` champions on `pit`, more than the alive enemies there: those take it. */
  const pitTakers = (pit: PitId, min: number): { side: Side; takers: ChampionState[] } | null => {
    const here = presentAt(state, pit);
    for (const side of SIDES) {
      const takers = here[side].filter((c) => pitActing.has(c.id));
      if (takers.length >= min && takers.length > here[other(side)].length) return { side, takers };
    }
    return null;
  };

  for (const id of Object.keys(PIT_SEQUENCE) as PitId[]) {
    const pit = state.pits[id];
    if (!pit.objective) {
      pit.capture = null;
      continue;
    }
    const rule = rules.objectives[pit.objective];
    const taken = pitTakers(id, rule.minChampions);
    if (!taken) {
      pit.capture = null;
      continue;
    }
    const { side, takers } = taken;
    const instant = !rule.extraRound || (rule.instantAt !== null && takers.length >= rule.instantAt);
    const held = pit.capture?.side === side && pit.capture.startedRound === state.round - 1;
    if (instant || held) {
      takePit(state, data, id, pit, side, takers, events);
      if (scuttleUp(PIT_SCUTTLE[id]) && riverSides(id).length === 1) takeScuttle(state, data, PIT_SCUTTLE[id], side, takers, events);
    } else {
      pit.capture = { side, startedRound: state.round };
      events.push({ type: 'objectiveStarted', objective: pit.objective, side, position: id, champions: takers.map((c) => c.id) });
    }
  }

  for (const id of Object.keys(SCUTTLE_PIT) as ScuttleId[]) {
    if (!scuttleUp(id)) continue;
    const taken = scuttleTakers(SCUTTLE_PIT[id], id, rules.objectives.scuttle.minChampions);
    if (taken) takeScuttle(state, data, id, taken.side, taken.takers, events);
  }
}

/** Clears jungle camps: the camp each `acting` alive champion (a step left on arrival) stands on. */
export function clearCamps(state: GameState, data: GameData, acting: ReadonlySet<string>, events: GameEvent[]): void {
  const { rules, graph } = data;
  const end = roundWindow(rules, state.round).end;

  const clear = (camp: string, c: ChampionState): void => {
    if (!(camp in state.camps) || state.camps[camp]! > end) return;
    const buff = BUFF_CAMPS.has(graph.positions[camp]!.camp!);
    const r = rules.camps;
    grant(c, buff ? r.buffGold : r.smallGold, buff ? r.buffXp : r.smallXp);
    state.camps[camp] = end + (buff ? r.buffRespawn : r.smallRespawn);
    state.campsSeen[c.side][camp] = state.camps[camp]!;
    events.push({ type: 'campCleared', camp, champion: c.id });
  };

  // Junglers first, then by id, so a shared camp goes to a deterministic clearer.
  const order = [...state.champions]
    .filter((c) => c.status === 'alive' && acting.has(c.id))
    .sort((a, b) => Number(b.role === 'jungle') - Number(a.role === 'jungle') || a.id.localeCompare(b.id));
  for (const c of order) if (graph.positions[c.position]?.kind === 'camp') clear(c.position, c);
}

/**
 * Herald launches after contacts: an alive carrier ordered to launch on a standing enemy tower
 * deals `heraldDamage` like any tower damage (plates, kill, gold) but without multiplier. Dead carriers lose the Herald;
 * a recalling (respawning) carrier keeps it.
 */
export function launchHeralds(state: GameState, data: GameData, orders: Orders, events: GameEvent[], forfeited: ReadonlySet<string> = new Set()): void {
  for (const c of state.champions) if (c.status === 'dead') c.hasHerald = false;

  for (const side of SIDES) {
    for (const order of orders[side]) {
      if (order.kind !== 'move' || !order.launchHerald) continue;
      const c = state.champions.find((x) => x.id === order.champion && x.side === side);
      if (!c || c.status !== 'alive' || !c.hasHerald || forfeited.has(c.id)) continue;
      const tower = c.position;
      const p = data.graph.positions[tower];
      if (p?.kind !== 'tower' || !p.side || p.side === side || (state.towers[tower] ?? 0) <= 0) continue;
      // Herald damage ignores the grubs/baron multiplier.
      damageTower(state, data, tower, data.rules.towers.heraldDamage, [c], events);
      c.hasHerald = false;
      events.push({ type: 'heraldLaunched', tower, side: p.side });
    }
  }
}
