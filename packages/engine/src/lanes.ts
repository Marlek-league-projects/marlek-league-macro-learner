import { matchupAdvantage } from '@lml/data';
import type { GameData, Lane, Role, Side } from '@lml/data/contracts';
import type { ChampionState, GameEvent, GameState, WavePos } from './contracts';
import { resolveFight } from './fight';
import { roundWindow, totalRounds } from './time';

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

export function grant(c: ChampionState, gold: number, xp = 0): void {
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

/** Alive champions of each side standing on a position of `lane`. */
function presentIn(state: GameState, data: GameData, lane: Lane): Record<Side, ChampionState[]> {
  const positions = new Set(data.graph.lanePositions(lane));
  const inLane = (side: Side): ChampionState[] =>
    state.champions.filter((c) => c.side === side && c.status === 'alive' && positions.has(c.position));
  return { blue: inLane('blue'), red: inLane('red') };
}

const pushing = (cs: ChampionState[]): boolean => cs.some((c) => c.stance === 'push');

/**
 * How exposed `side` is to a gank in `lane`: its wave position toward the enemy tower (-1 under its own tower,
 * 0 in the middle, 1 in front of the enemy tower), +1 when one of its alive champions in the lane is on Push.
 */
export function laneExposure(state: GameState, data: GameData, side: Side, lane: Lane): number {
  const wave = state.waves[lane] * -waveToward(side);
  return wave + (pushing(presentIn(state, data, lane)[side]) ? 1 : 0);
}

/**
 * Side with lane pressure in `lane`: its champions present there score higher in a fight on the lane middle (no
 * tower: matchup, level and lead). Null on a tie or when a side has nobody in the lane.
 */
export function lanePressure(state: GameState, data: GameData, lane: Lane): Side | null {
  const present = presentIn(state, data, lane);
  if (present.blue.length === 0 || present.red.length === 0) return null;
  const mid = data.graph.lanePositions(lane).find((id) => data.graph.positions[id]!.kind === 'laneMid')!;
  const ids = (side: Side): string[] => present[side].map((c) => c.id);
  const total = totalRounds(data.rules);
  const stage = roundWindow(data.rules, Math.min(state.round, total)).stage;
  return resolveFight(state, data, mid, ids('blue'), ids('red'), stage).winner;
}

/**
 * Mutates `state`: waves, tower hp, gold, xp and trade lead for one round. A lane in `tradeWinners` had a trade
 * contact this round (null: tied); otherwise even laners push by fight score. An uneven lane with both sides
 * present and no gank this round (not in `ganked`) is under pressure: the smaller side farms at
 * `economy.pressureFarmShare`.
 */
export function updateLanes(
  state: GameState,
  data: GameData,
  tradeWinners: Partial<Record<Lane, Side | null>>,
  events: GameEvent[],
  ganked: ReadonlySet<Lane> = new Set(),
): void {
  const { rules } = data;
  const win = roundWindow(rules, state.round);
  const alive = (c: ChampionState): boolean => c.status === 'alive';

  for (const lane of LANES) {
    const present = presentIn(state, data, lane);

    // 2. wave movement
    const from = state.waves[lane];
    const nb = present.blue.length, nr = present.red.length;
    const winner = tradeWinners[lane] ?? null;
    let step: number;
    if (nb !== nr) step = waveToward(nb < nr ? 'blue' : 'red');
    else if (nb > 0) {
      // No trade this round: the laners' fight scores (matchup, lead, strength) decide, nobody dies.
      const pusher = lane in tradeWinners ? winner : lanePressure(state, data, lane);
      step = pusher ? waveToward(other(pusher)) : 0;
    } else step = -from;
    // A side with a Push laner in the lane shoves the wave one extra step toward the enemy (both pushing cancel).
    let extra = 0;
    for (const side of ['blue', 'red'] as Side[]) if (pushing(present[side])) extra += waveToward(other(side));
    const to = Math.max(-1, Math.min(1, from + sign(step) + extra)) as WavePos;
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
          const base = rules.towers.pushDamage[n - 1]! + (pushing(attackers) ? rules.lanes.pushBonus : 0);
          damageTower(state, data, front, base * towerMultiplier(state, data, attacker), attackers, events);
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
    const underPressure = nb > 0 && nr > 0 && nb !== nr && !ganked.has(lane);
    const pressured: Side | null = underPressure ? (nb < nr ? 'blue' : 'red') : null;
    for (const side of ['blue', 'red'] as Side[]) {
      const here = present[side];
      const carries = here.filter((c) => c.role !== 'support');
      const share = side === pressured ? rules.economy.pressureFarmShare : 1;
      const gold = (rules.economy.farmGoldPerMin * win.seconds * share) / 60;
      const soloXp = (rules.economy.farmXpPerMin * win.seconds * share) / 60;
      // A real adc + support duo: each gets `duoXpShare` of a solo laner's xp. Otherwise a support takes
      // `supportShare` of it, as of the gold.
      const duo = here.some((c) => c.role === 'adc') && here.some((c) => c.role === 'support');
      const duoXp = soloXp * rules.economy.duoXpShare;
      for (const c of carries) grant(c, gold / carries.length, (duo ? duoXp : soloXp) / carries.length);
      const supportXp = duo ? duoXp : soloXp * rules.economy.supportShare;
      for (const c of here) if (c.role === 'support') grant(c, gold * rules.economy.supportShare, supportXp);
      // 6. trade winner lead
      if (winner === side) for (const c of here) c.bonusLead += rules.economy.tradeLead;
    }
  }

  for (const c of state.champions) {
    if (alive(c)) grant(c, (rules.economy.passiveGoldPerMin * win.seconds) / 60);
  }
}
