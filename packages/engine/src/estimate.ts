import type { GameData, Side } from '@lml/data/contracts';
import type { ChampionState, EnemyInfo, PlayerView } from './contracts';
import { roundWindow, totalRounds } from './time';

const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');

/**
 * What an enemy is assumed to have, from what `view.side` knows: xp from its level when visible, otherwise the
 * expected farm so far; items from the expected farm and passive gold; lead from its side's dragons.
 */
export function estimateEnemy(
  view: Pick<PlayerView, 'round' | 'side' | 'objectivesTaken'>,
  data: GameData,
  e: Pick<EnemyInfo, 'role' | 'level'>,
): Pick<ChampionState, 'xp' | 'items' | 'bonusLead'> {
  const { economy, buffs, phases } = data.rules;
  const round = Math.min(view.round, totalRounds(data.rules));
  const minutes = Math.max(0, roundWindow(data.rules, round).start - phases[0]!.start) / 60;
  const share = e.role === 'support' ? economy.supportShare : 1;
  const xpShare = e.role === 'adc' || e.role === 'support' ? economy.duoXpShare : 1;
  const xp = e.level !== null ? economy.levelXp[e.level - 1]! : economy.farmXpPerMin * xpShare * minutes;
  const items = (economy.farmGoldPerMin * share + economy.passiveGoldPerMin) * minutes;
  const bonusLead = (view.objectivesTaken[other(view.side)].dragon ?? 0) * buffs.dragonLead;
  return { xp, items, bonusLead };
}
