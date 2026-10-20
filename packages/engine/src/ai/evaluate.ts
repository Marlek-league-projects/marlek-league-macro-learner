import type { GameData, Lane, ObjectiveId, Side } from '@lml/data/contracts';
import type { PlayerView } from '../contracts';
import { estimateEnemy } from '../estimate';
import { lead } from '../fight';
import { objectiveAt, type PitId } from '../objectives';
import { roundWindow, totalRounds } from '../time';

const LANES: Lane[] = ['top', 'mid', 'bot'];
export const PITS: PitId[] = ['dragon-pit', 'baron-pit'];

export const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');

/** The wave of `lane` seen from `view.side`: 1 at the enemy front tower, -1 at our own. */
export function ourWave(view: PlayerView, lane: Lane): number {
  return view.side === 'blue' ? view.waves[lane] : -view.waves[lane];
}

/** End time (s) of `round`, or Infinity past the last round. */
function roundEnd(data: GameData, round: number): number {
  return round <= totalRounds(data.rules) ? roundWindow(data.rules, round).end : Infinity;
}

export interface PitTiming {
  objective: ObjectiveId | null;
  /** Up during the view's round. */
  live: boolean;
  /** Spawns at the start of the next round. */
  soon: boolean;
}

export function pitTiming(view: PlayerView, data: GameData, id: PitId): PitTiming {
  const pit = view.pits[id];
  if (pit.objective) return { objective: pit.objective, live: true, soon: false };
  if (pit.nextSpawn === null) return { objective: null, live: false, soon: false };
  const objective = objectiveAt(data, id, pit.nextSpawn);
  const live = pit.nextSpawn <= roundEnd(data, view.round);
  const soon = !live && view.round < totalRounds(data.rules) && pit.nextSpawn <= roundEnd(data, view.round + 1);
  return { objective, live, soon };
}

/** Pit captures in progress for us, or our champions standing on an objective that is up or about to be. */
function pitControl(view: PlayerView, data: GameData): number {
  let score = 0;
  for (const id of PITS) {
    const t = pitTiming(view, data, id);
    if (!t.objective || (!t.live && !t.soon)) continue;
    const rule = data.rules.objectives[t.objective];
    const capture = view.pits[id].capture;
    const here = view.allies.filter((c) => c.status === 'alive' && c.position === id).length;
    if (capture?.side === view.side) score += rule.value * data.aiTuning.captureShare;
    else if (here >= rule.minChampions) score += rule.value * data.aiTuning.presenceShare;
  }
  return score;
}

/**
 * Board value for `view.side`: ally lead sum (unspent gold included, deaths cost a kill) minus the
 * estimated enemy lead, plus objective, plate and tower values, pit control and wave pressure.
 */
export function evaluate(view: PlayerView, data: GameData): number {
  const { rules } = data;
  let score = 0;
  for (const c of view.allies) {
    score += lead(c, rules) + c.gold;
    if (c.status === 'dead') score -= rules.economy.killGold + rules.economy.killXp;
  }
  for (const e of view.enemies) {
    const est = estimateEnemy(view, data, e);
    score -= est.xp + est.items + est.bonusLead;
  }
  for (const [side, sign] of [[view.side, 1], [other(view.side), -1]] as const) {
    for (const [id, n] of Object.entries(view.objectivesTaken[side])) {
      score += sign * (n ?? 0) * rules.objectives[id as ObjectiveId].value;
    }
    score += sign * (view.platesTaken[side] * rules.verdict.plateValue + view.towersDestroyed[side] * rules.verdict.towerValue);
  }
  score += pitControl(view, data);
  const round = Math.min(view.round, totalRounds(rules));
  const farmPerRound = (rules.economy.farmGoldPerMin * roundWindow(rules, round).seconds) / 60;
  for (const lane of LANES) score += ourWave(view, lane) * farmPerRound;
  return score;
}
