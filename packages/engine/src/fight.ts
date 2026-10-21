import { matchupAdvantage } from '@lml/data';
import type { GameData, Rules, Side, Stage } from '@lml/data/contracts';
import type { ChampionState, GameState } from './contracts';
import { laneExposure } from './lanes';

const EPSILON = 1e-9;

/** A champion's combat lead: xp + items + bonus lead. `rules` is reserved for future weighting. */
export function lead(c: ChampionState, _rules: Rules): number {
  return c.xp + c.items + c.bonusLead;
}

/** A wounded champion weighs less: its fight-score contributions are scaled by `1 - fightWeight * (1 - hp / max)`. */
export function healthFactor(c: ChampionState, rules: Rules): number {
  const { max, fightWeight } = rules.health;
  return 1 - fightWeight * (1 - c.hp / max);
}

/** Side owning a standing tower at `position`, or null. */
function towerOwner(state: GameState, data: GameData, position: string): Side | null {
  const p = data.graph.positions[position];
  if (!p || p.kind !== 'tower' || !p.side) return null;
  return (state.towers[position] ?? 0) > 0 ? p.side : null;
}

export function fightScore(
  state: GameState,
  data: GameData,
  side: Side,
  ids: string[],
  enemyIds: string[],
  stage: Stage,
  towerFor: Side | null,
): number {
  const W = data.rules.fight;
  const byId = (id: string): ChampionState => state.champions.find((c) => c.id === id)!;
  const hasTower = towerFor === side;
  const teamfight = ids.length + enemyIds.length >= W.teamfightMinTotal;
  let score = 0;
  for (const id of ids) {
    const c = byId(id);
    const ratings = data.champions[c.id];
    const base = (teamfight ? ratings?.teamfight : ratings?.skirmish)?.[stage] ?? 0;
    const advs: number[] = [];
    for (const e of enemyIds) {
      const a = matchupAdvantage(data, c.id, byId(e).id, stage);
      if (a !== null) advs.push(a);
    }
    const matchup = advs.length ? advs.reduce((x, y) => x + y, 0) / advs.length : 0;
    const own = W.numbers[stage] + (W.lead * lead(c, data.rules)) / 1000 + W.matchup * matchup + (W.strength * base) / 10;
    score += own * healthFactor(c, data.rules);
  }
  // The tower counts once, as a fraction of a champion and one extra weak champion.
  if (hasTower) score += W.numbers[stage] * W.towerNumbersFactor + (W.strength * W.towerStrength) / 10;
  return score;
}

/**
 * Fight-score modifier of the `ganked` side at `position`: `-fight.gankExposed` when its `laneExposure` is positive
 * (wave pushed toward the enemy tower, or a laner on Push standing forward with the wave in the middle), 0 otherwise
 * (under its own tower, the tower already counts).
 */
export function gankModifier(state: GameState, data: GameData, position: string, ganked: Side): number {
  const lane = data.graph.positions[position]?.lane;
  if (!lane) return 0;
  return laneExposure(state, data, ganked, lane) > 0 ? -data.rules.fight.gankExposed : 0;
}

/** `ganked` is the defending side of a gank contact, whose score gets `gankModifier`. */
export function resolveFight(
  state: GameState,
  data: GameData,
  position: string,
  blue: string[],
  red: string[],
  stage: Stage,
  ganked: Side | null = null,
): { winner: Side | null; scores: Record<Side, number> } {
  const towerFor = towerOwner(state, data, position);
  const scores: Record<Side, number> = {
    blue: fightScore(state, data, 'blue', blue, red, stage, towerFor),
    red: fightScore(state, data, 'red', red, blue, stage, towerFor),
  };
  if (ganked) scores[ganked] += gankModifier(state, data, position, ganked);
  const diff = scores.blue - scores.red;
  const winner = Math.abs(diff) < EPSILON ? null : diff > 0 ? 'blue' : 'red';
  return { winner, scores };
}

/**
 * Graded deaths: `floor(gap / fight.deathGap)` of the `eligible` losers die, most wounded first (lowest hp, then id).
 * `gap` is the winner's score minus the loser's.
 */
export function fightVictims(state: GameState, data: GameData, eligible: string[], gap: number): string[] {
  const n = Math.min(eligible.length, Math.max(0, Math.floor(gap / data.rules.fight.deathGap + EPSILON)));
  const hp = (id: string): number => state.champions.find((c) => c.id === id)!.hp;
  const order = [...eligible].sort((a, b) => hp(a) - hp(b) || (a < b ? -1 : a > b ? 1 : 0));
  return order.slice(0, n);
}
