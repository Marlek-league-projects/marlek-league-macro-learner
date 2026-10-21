import { matchupAdvantage } from '@lml/data';
import type { GameData, Rules, Side, Stage } from '@lml/data/contracts';
import type { ChampionState, GameState } from './contracts';

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

export function resolveFight(
  state: GameState,
  data: GameData,
  position: string,
  blue: string[],
  red: string[],
  stage: Stage,
): { winner: Side | null; scores: Record<Side, number> } {
  const towerFor = towerOwner(state, data, position);
  const scores: Record<Side, number> = {
    blue: fightScore(state, data, 'blue', blue, red, stage, towerFor),
    red: fightScore(state, data, 'red', red, blue, stage, towerFor),
  };
  const diff = scores.blue - scores.red;
  const winner = Math.abs(diff) < EPSILON ? null : diff > 0 ? 'blue' : 'red';
  return { winner, scores };
}
