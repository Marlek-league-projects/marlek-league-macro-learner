import { matchupAdvantage } from '@lml/data';
import type { GameData, Lane, Role, Side } from '@lml/data/contracts';
import type { ChampionState, GameEvent, GameState, WavePos } from './contracts';
import { roundWindow } from './time';

const LANES: Lane[] = ['top', 'mid', 'bot'];
const LANE_ROLES: Record<Lane, Role[]> = { top: ['top'], mid: ['mid'], bot: ['adc', 'support'] };
const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');
const waveToward = (s: Side): WavePos => (s === 'blue' ? -1 : 1);

/** Lowest-tier standing tower of `side` in `lane`, or null. */
export function frontTower(state: GameState, data: GameData, side: Side, lane: Lane): string | null {
  return data.graph.towers(side, lane).find((id) => (state.towers[id] ?? 0) > 0) ?? null;
}

/** Tower damage multiplier of `side`: voidgrubs times active baron. */
export function towerMultiplier(state: GameState, data: GameData, side: Side): number {
  const b = data.rules.buffs;
  return (state.grubs[side] ? b.grubsMult : 1) * (state.baronUntilRound[side] >= state.round ? b.baronMult : 1);
}

function grant(c: ChampionState, gold: number, xp = 0): void {
  c.gold += gold;
  c.goldEarned += gold;
  c.xp += xp;
}

function sign(n: number): WavePos {
  return (n > 0 ? 1 : n < 0 ? -1 : 0) as WavePos;
}

/**
 * Mutates `state`: deals `damage` to `tower` (clamped at 0), credits plates crossed and the kill to the
 * attacking side, splits plate gold (before `platesGoldUntil`) and tower gold among `attackers`.
 */
export function damageTower(
  state: GameState,
  data: GameData,
  tower: string,
  damage: number,
  attackers: ChampionState[],
  events: GameEvent[],
): void {
  const { rules } = data;
  const defender = data.graph.positions[tower]!.side!;
  const attacker = other(defender);
  const before = state.towers[tower]!;
  const after = Math.max(0, before - damage);
  state.towers[tower] = after;
  const plates = Math.ceil(before) - Math.ceil(after);
  const destroyed = after <= 0;
  let gold = 0;
  if (plates > 0) {
    state.platesTaken[attacker] += plates;
    if (roundWindow(rules, state.round).start < rules.towers.platesGoldUntil) gold += plates * rules.towers.plateGold;
  }
  if (destroyed) {
    state.towersDestroyed[attacker] += 1;
    gold += rules.towers.towerGold;
  }
  for (const c of attackers) grant(c, gold / attackers.length);
  events.push({ type: 'towerDamage', tower, side: defender, damage, hp: after, destroyed });
}

/** Mutates `state`: waves, tower hp, gold, xp and trade lead for one round. */
export function updateLanes(
  state: GameState,
  data: GameData,
  tradeWinners: Partial<Record<Lane, Side | null>>,
  events: GameEvent[],
): void {
  const { rules } = data;
  const win = roundWindow(rules, state.round);
  const alive = (c: ChampionState): boolean => c.status === 'alive';

  for (const lane of LANES) {
    const positions = new Set(data.graph.lanePositions(lane));
    const inLane = (side: Side): ChampionState[] =>
      state.champions.filter((c) => c.side === side && alive(c) && positions.has(c.position));
    const present = { blue: inLane('blue'), red: inLane('red') };

    // 2. wave movement
    const from = state.waves[lane];
    const nb = present.blue.length, nr = present.red.length;
    const winner = tradeWinners[lane] ?? null;
    let step: number;
    if (nb !== nr) step = waveToward(nb < nr ? 'blue' : 'red');
    else if (nb > 0) step = winner ? waveToward(other(winner)) : 0;
    else step = -from;
    const to = Math.max(-1, Math.min(1, from + sign(step))) as WavePos;
    state.waves[lane] = to;
    if (to !== from) events.push({ type: 'wave', lane, from, to });

    // 3 + 4. tower damage
    if (to !== 0) {
      const defender: Side = to === -1 ? 'blue' : 'red';
      const attacker = other(defender);
      const front = frontTower(state, data, defender, lane);
      if (front) {
        const attackers = present[attacker].filter((c) => c.position === front);
        const defenders = present[defender].filter((c) => c.position === front);
        const pushed = attackers.length > 0 && defenders.length === 0;
        if (pushed) {
          const n = Math.min(attackers.length, rules.towers.pushDamage.length);
          damageTower(state, data, front, rules.towers.pushDamage[n - 1]! * towerMultiplier(state, data, attacker), attackers, events);
        }
        // 4. absent-laner chip (only when the tower did not already take push damage this round)
        const chipFront = pushed ? null : front;
        if (chipFront && present[defender].length === 0 && present[attacker].length > 0) {
          const pressured = LANE_ROLES[lane].some((role) => {
            const a = present[attacker].find((c) => c.role === role);
            const d = state.champions.find((c) => c.side === defender && c.role === role);
            if (!a || !d) return false;
            return (matchupAdvantage(data, a.id, d.id, win.stage) ?? 0) > 0;
          });
          if (pressured) damageTower(state, data, chipFront, rules.towers.absentLanerChip, present[attacker], events);
        }
      }
    }

    // 5. farming
    for (const side of ['blue', 'red'] as Side[]) {
      const here = present[side];
      const carries = here.filter((c) => c.role !== 'support');
      const gold = (rules.economy.farmGoldPerMin * win.seconds) / 60;
      const xp = (rules.economy.farmXpPerMin * win.seconds) / 60;
      for (const c of carries) grant(c, gold / carries.length, xp / carries.length);
      const share = rules.economy.supportShare;
      for (const c of here) if (c.role === 'support') grant(c, gold * share, xp * share);
      // 6. trade winner lead
      if (winner === side) for (const c of here) c.bonusLead += rules.economy.tradeLead;
    }
  }

  for (const c of state.champions) {
    if (alive(c)) grant(c, (rules.economy.passiveGoldPerMin * win.seconds) / 60);
  }
}
