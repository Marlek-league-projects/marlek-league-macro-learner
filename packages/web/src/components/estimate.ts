// What the player can estimate about the enemy team from its view (mirrors the AI's own estimate).
import type { GameData } from '@lml/data/contracts';
import type { ChampionState, EnemyInfo, PlayerView } from '@lml/engine/contracts';

export interface Estimate {
  xp: number;
  gold: number;
}

/** Expected xp and gold of an enemy: xp from its level when seen, otherwise the expected farm so far. */
export function estimateEnemy(data: GameData, e: EnemyInfo, roundStart: number): Estimate {
  const { economy, phases } = data.rules;
  const minutes = Math.max(0, roundStart - phases[0]!.start) / 60;
  const share = e.role === 'support' ? economy.supportShare : 1;
  const xp = e.level !== null ? economy.levelXp[e.level - 1]! : economy.farmXpPerMin * share * minutes;
  return { xp, gold: (economy.farmGoldPerMin * share + economy.passiveGoldPerMin) * minutes };
}

/** Team gold and xp lead over the estimated enemy team. */
export function teamLead(view: PlayerView, data: GameData, roundStart: number): Estimate {
  let xp = 0;
  let gold = 0;
  for (const c of view.allies) {
    xp += c.xp;
    gold += c.goldEarned;
  }
  for (const e of view.enemies) {
    const est = estimateEnemy(data, e, roundStart);
    xp -= est.xp;
    gold -= est.gold;
  }
  return { xp, gold };
}

/** 0..1 bar fill: 0.5 when even with the estimated lane opponent, more when ahead. */
export function leadShare(view: PlayerView, data: GameData, c: ChampionState, roundStart: number): number {
  const opponent = view.enemies.find((e) => e.role === c.role);
  if (!opponent) return 0.5;
  const est = estimateEnemy(data, opponent, roundStart);
  const mine = c.xp + c.goldEarned;
  const theirs = est.xp + est.gold;
  const scale = Math.max(mine, theirs, 1);
  return Math.min(1, Math.max(0, 0.5 + (mine - theirs) / (2 * scale)));
}

/** 0..1 progress through the current level. */
export function levelProgress(data: GameData, xp: number, level: number): number {
  const table = data.rules.economy.levelXp;
  const from = table[level - 1] ?? 0;
  const to = table[level];
  if (to === undefined) return 1;
  return Math.min(1, Math.max(0, (xp - from) / (to - from)));
}
