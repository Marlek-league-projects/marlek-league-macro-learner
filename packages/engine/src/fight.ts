import { matchupAdvantage } from '@lml/data';
import type { GameData, Rules, Side, Stage } from '@lml/data/contracts';
import type { ChampionState, GameState } from './contracts';

const EPSILON = 1e-9;

/** A champion's combat lead: xp + items + bonus lead. `rules` is reserved for future weighting. */
export function lead(c: ChampionState, _rules: Rules): number {
  return c.xp + c.items + c.bonusLead;
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
  const n = ids.length + (hasTower ? W.towerNumbersFactor : 0);
  const teamfight = ids.length + enemyIds.length >= W.teamfightMinTotal;
  let leadSum = 0;
  let matchupSum = 0;
  let strengthSum = hasTower ? W.towerStrength / 10 : 0; // the tower counts once, as one extra weak champion
  for (const id of ids) {
    const c = byId(id);
    leadSum += lead(c, data.rules) / 1000;
    const ratings = data.champions[c.id];
    const base = (teamfight ? ratings?.teamfight : ratings?.skirmish)?.[stage] ?? 0;
    strengthSum += base / 10;
    const advs: number[] = [];
    for (const e of enemyIds) {
      const a = matchupAdvantage(data, c.id, byId(e).id, stage);
      if (a !== null) advs.push(a);
    }
    if (advs.length) matchupSum += advs.reduce((x, y) => x + y, 0) / advs.length;
  }
  return W.numbers[stage] * n + W.lead * leadSum + W.matchup * matchupSum + W.strength * strengthSum;
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
