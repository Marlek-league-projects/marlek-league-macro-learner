import type { GameData, ObjectiveId, Side } from '@lml/data/contracts';
import type { ChampionState, GameEvent, GameState, Orders, PitState } from './contracts';
import { lead } from './fight';
import { roundWindow } from './time';

type PitId = keyof GameState['pits'];
type ScuttleId = keyof GameState['scuttles'];

const SIDES: Side[] = ['blue', 'red'];
/** Objectives each pit hosts, in the order they replace each other. */
const PIT_SEQUENCE: Record<PitId, ObjectiveId[]> = {
  'dragon-pit': ['dragon'],
  'baron-pit': ['voidgrubs', 'herald', 'baron'],
};
/** Pit a scuttle's vision ward covers. */
const SCUTTLE_PIT: Record<ScuttleId, PitId> = { 'scuttle-top': 'baron-pit', 'scuttle-bot': 'dragon-pit' };
const BUFF_CAMPS = new Set(['bluebuff', 'redbuff']);

function grant(c: ChampionState, gold: number, xp = 0): void {
  c.gold += gold;
  c.goldEarned += gold;
  c.xp += xp;
}

/** Objective of `pit` alive at time `t`: the first in its sequence not yet despawned. */
function objectiveAt(data: GameData, pit: PitId, t: number): ObjectiveId {
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
    // Loop so that a state jumping several timers ahead settles on the current objective.
    for (;;) {
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

/** The only side present with at least `min` champions, or null. */
function soleTaker(present: Record<Side, ChampionState[]>, min: number): Side | null {
  const sides = SIDES.filter((s) => present[s].length > 0);
  return sides.length === 1 && present[sides[0]!].length >= min ? sides[0]! : null;
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

/** End of round: scuttles taken on arrival, pit objectives captured or their capture reset. */
export function captureObjectives(state: GameState, data: GameData, events: GameEvent[]): void {
  const { rules } = data;
  const end = roundWindow(rules, state.round).end;

  for (const id of Object.keys(SCUTTLE_PIT) as ScuttleId[]) {
    if (state.scuttles[id] > end) continue;
    const rule = rules.objectives.scuttle;
    const present = presentAt(state, id);
    const side = soleTaker(present, rule.minChampions);
    if (!side) continue;
    const takers = present[side];
    reward(state, data, 'scuttle', side, takers);
    state.scuttles[id] = end + (rule.respawn ?? Infinity);
    const wardAt = SCUTTLE_PIT[id];
    state.wards = state.wards.filter((w) => !(w.scuttle && w.side === side && w.position === wardAt));
    state.wards.push({ side, position: wardAt, placedRound: state.round, scuttle: true });
    events.push({ type: 'objectiveTaken', objective: 'scuttle', side, position: id, champions: takers.map((c) => c.id) });
  }

  for (const id of Object.keys(PIT_SEQUENCE) as PitId[]) {
    const pit = state.pits[id];
    if (!pit.objective) {
      pit.capture = null;
      continue;
    }
    const rule = rules.objectives[pit.objective];
    const present = presentAt(state, id);
    const side = soleTaker(present, rule.minChampions);
    if (!side) {
      pit.capture = null;
      continue;
    }
    const takers = present[side];
    const instant = !rule.extraRound || (rule.instantAt !== null && takers.length >= rule.instantAt);
    const held = pit.capture?.side === side && pit.capture.startedRound === state.round - 1;
    if (instant || held) {
      takePit(state, data, id, pit, side, takers, events);
    } else {
      pit.capture = { side, startedRound: state.round };
      events.push({ type: 'objectiveStarted', objective: pit.objective, side, position: id, champions: takers.map((c) => c.id) });
    }
  }
}

/**
 * Clears jungle camps: the arrival camp of any alive champion, and the `via` camp of a jungler
 * fast enough (`clearSpeed >= camps.fastClearAt`).
 */
export function clearCamps(
  state: GameState,
  data: GameData,
  viaById: Record<string, string | undefined>,
  events: GameEvent[],
): void {
  const { rules, graph } = data;
  const end = roundWindow(rules, state.round).end;
  const isCamp = (pos: string | undefined): pos is string => !!pos && graph.positions[pos]?.kind === 'camp';

  const clear = (camp: string, c: ChampionState): void => {
    if (!(camp in state.camps) || state.camps[camp]! > end) return;
    const buff = BUFF_CAMPS.has(graph.positions[camp]!.camp!);
    const r = rules.camps;
    grant(c, buff ? r.buffGold : r.smallGold, buff ? r.buffXp : r.smallXp);
    state.camps[camp] = end + (buff ? r.buffRespawn : r.smallRespawn);
    events.push({ type: 'campCleared', camp, champion: c.id });
  };

  // Junglers first, then by id, so a shared camp goes to a deterministic clearer.
  const order = [...state.champions]
    .filter((c) => c.status === 'alive')
    .sort((a, b) => Number(b.role === 'jungle') - Number(a.role === 'jungle') || a.id.localeCompare(b.id));
  for (const c of order) {
    const via = viaById[c.id];
    const fast = (data.champions[c.id]?.clearSpeed ?? 0) >= rules.camps.fastClearAt;
    if (c.role === 'jungle' && fast && isCamp(via)) clear(via, c);
    if (isCamp(c.position)) clear(c.position, c);
  }
}

/**
 * Herald launches after contacts: an alive carrier ordered to launch on a standing enemy tower
 * deals `heraldDamage`. Carriers who are not alive lose the Herald.
 */
export function launchHeralds(state: GameState, data: GameData, orders: Orders, events: GameEvent[]): void {
  for (const c of state.champions) if (c.status !== 'alive') c.hasHerald = false;

  for (const side of SIDES) {
    for (const order of orders[side]) {
      if (order.kind !== 'move' || !order.launchHerald) continue;
      const c = state.champions.find((x) => x.id === order.champion && x.side === side);
      if (!c || c.status !== 'alive' || !c.hasHerald) continue;
      const tower = c.position;
      const p = data.graph.positions[tower];
      if (p?.kind !== 'tower' || !p.side || p.side === side || (state.towers[tower] ?? 0) <= 0) continue;
      const damage = data.rules.towers.heraldDamage;
      const hp = Math.max(0, state.towers[tower]! - damage);
      state.towers[tower] = hp;
      c.hasHerald = false;
      events.push({ type: 'towerDamage', tower, side: p.side, damage, hp, destroyed: hp <= 0 });
      events.push({ type: 'heraldLaunched', tower, side: p.side });
    }
  }
}
