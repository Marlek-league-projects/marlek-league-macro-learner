import type { GameData, Side } from '@lml/data/contracts';
import type { EnemyEstimate, EnemyInfo, PlayerView } from './contracts';

const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');

/**
 * What an enemy is assumed to have, from what `view.side` knows, sized on its own champion of the same role (the
 * mirror): xp from its level when visible, otherwise the mirror's xp; items the mirror's, scaled by the enemy team's
 * gold earned over its own (the public scoreboard); lead from the enemy side's dragons; hp as seen, full when
 * unseen. Sizing on the mirror keeps the estimate as far along as the game really is, so neither side sees every
 * unseen enemy ahead of it.
 */
export function estimateEnemy(
  view: Pick<PlayerView, 'side' | 'allies' | 'objectivesTaken' | 'scoreboard'>,
  data: GameData,
  e: Pick<EnemyInfo, 'role' | 'level' | 'hp'>,
): EnemyEstimate {
  const { economy, buffs } = data.rules;
  const enemy = other(view.side);
  const mirror = view.allies.find((a) => a.role === e.role);
  const own = view.scoreboard.goldEarned[view.side];
  const ratio = own > 0 ? view.scoreboard.goldEarned[enemy] / own : 1;
  const xp = e.level !== null ? economy.levelXp[e.level - 1]! : (mirror?.xp ?? 0);
  const items = (mirror?.items ?? 0) * ratio;
  const bonusLead = (view.objectivesTaken[enemy].dragon ?? 0) * buffs.dragonLead;
  return { xp, items, bonusLead, hp: e.hp ?? data.rules.health.max };
}
