// What the HUD above each visible token and the team cards show: HP, power, level and XP progress.
// Fog of war holds: an enemy shows values only while it is visible, and its power is the side's estimate.
import type { GameData } from '@lml/data/contracts';
import type { EnemyEstimate, EnemyInfo, PlayerView } from '@lml/engine/contracts';

/** Strength points per power point: the shown power is the strength value scaled to a short integer. */
export const POWER_UNIT = 100;

export interface Hud {
  /** 0..1 share of full health. */
  hp: number;
  /** The strength value (fight lead at the level's floor), as a short integer. */
  power: number;
  level: number;
  /** 0..1 progress to the next level; null when unknown (an enemy's exact XP is never shown). */
  xp: number | null;
}

/** 0..1 progress from the start of `level` to the next one (1 at the last level). */
export function xpProgress(data: GameData, xp: number, level: number): number {
  const table = data.rules.economy.levelXp;
  const from = table[level - 1] ?? 0;
  const to = table[level];
  if (to === undefined) return 1;
  return Math.min(1, Math.max(0, (xp - from) / (to - from)));
}

/** 0..1 share of full health, clamped. */
export function hpShare(hp: number, max: number): number {
  return Math.min(1, Math.max(0, hp / max));
}

/** HP bar colour: green at full health through yellow to red at none. */
export function hpColor(share: number): string {
  const s = Math.min(1, Math.max(0, share));
  return `hsl(${Math.round(120 * s)} 75% 45%)`;
}

/** The shown power of a strength value. */
export function powerOf(strength: number): number {
  return Math.round(strength / POWER_UNIT);
}

/**
 * Strength (fight lead: xp + items + bonus lead) of every pawn on the map, keyed by champion id, xp counted at
 * its level's floor so allies and enemies compare on what both show. Allies show their own items and lead.
 * A visible enemy shows what this side assumes it has, the engine's shared estimate (sized on its own-side
 * mirror and the scoreboard gold), never its true lead. Unseen enemies are left out.
 */
export function strengths(
  view: PlayerView,
  data: GameData,
  level: (xp: number) => number,
  estimate: (enemy: EnemyInfo) => EnemyEstimate,
): Record<string, number> {
  const floor = (lvl: number) => data.rules.economy.levelXp[lvl - 1] ?? 0;
  const out: Record<string, number> = {};
  for (const c of view.allies) out[c.id] = floor(level(c.xp)) + c.items + c.bonusLead;
  for (const e of view.enemies) {
    if (!e.visible || !e.position || e.level === null) continue;
    const est = estimate(e);
    out[e.id] = est.xp + est.items + est.bonusLead;
  }
  return out;
}

/**
 * HUD values of every champion the player may see, keyed by id: every ally, and each enemy only while
 * it is visible (its true HP and level, as the view gives them; its estimated power; no XP progress).
 */
export function hudValues(
  view: PlayerView,
  data: GameData,
  level: (xp: number) => number,
  estimate: (enemy: EnemyInfo) => EnemyEstimate,
): Record<string, Hud> {
  const strength = strengths(view, data, level, estimate);
  const max = data.rules.health.max;
  const out: Record<string, Hud> = {};
  for (const c of view.allies) {
    const lvl = level(c.xp);
    out[c.id] = { hp: hpShare(c.hp, max), power: powerOf(strength[c.id]!), level: lvl, xp: xpProgress(data, c.xp, lvl) };
  }
  for (const e of view.enemies) {
    const s = strength[e.id];
    if (s === undefined || e.level === null || e.hp === null) continue;
    out[e.id] = { hp: hpShare(e.hp, max), power: powerOf(s), level: e.level, xp: null };
  }
  return out;
}

/** Height of a token's HUD stack above its centre (map units): the text top down to the role icon. */
export const HUD_RISE = 53;

/** Gap between a token's centre and its HUD drawn below it, under the name (map units). */
export const HUD_DROP = 29;

/** Top of a token's HUD (map units): above the role icon, or below the name when it would leave the map's top. */
export function hudTop(y: number): number {
  return y - HUD_RISE >= 0 ? y - HUD_RISE : y + HUD_DROP;
}

/** One-line HUD summary for tooltips. */
export function hudText(hud: Hud, hpMax: number): string {
  return `PV ${Math.round(hud.hp * hpMax)} · niv ${hud.level} · puissance ${hud.power}`;
}
