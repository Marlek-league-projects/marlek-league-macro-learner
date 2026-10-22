import type { GameData, Rules, Side } from '@lml/data/contracts';
import type { ChampionState, GameEvent, GameState } from './contracts';
import { grant } from './lanes';
import { roundWindow, totalRounds } from './time';

/** Champion level 1..18 for an xp total. */
export function level(xp: number, rules: Rules): number {
  let l = 1;
  rules.economy.levelXp.forEach((need, i) => {
    if (xp >= need) l = i + 1;
  });
  return l;
}

/** Victims spend their unspent gold on items and die (and lose the herald); alive winners split kill gold and xp per victim. */
export function applyKill(
  state: GameState,
  data: GameData,
  victims: string[],
  winners: string[],
  events: GameEvent[],
): void {
  const { economy, death } = data.rules;
  const stage = roundWindow(data.rules, state.round).stage;
  const deadRounds = death.roundsByStage[stage]!;
  const takers = state.champions.filter((c) => winners.includes(c.id) && c.status === 'alive');
  for (const id of victims) {
    const v = state.champions.find((c) => c.id === id);
    if (!v) continue;
    // A death spends the unspent gold on items, as a recall does.
    v.items += v.gold;
    v.gold = 0;
    v.status = 'dead';
    v.respawnRound = state.round + deadRounds;
    v.hasHerald = false;
    state.kills[v.side === 'blue' ? 'red' : 'blue'] += 1;
    for (const w of takers) grant(w, economy.killGold / takers.length, economy.killXp / takers.length);
    events.push({ type: 'death', champion: v.id, position: v.position, respawnRound: v.respawnRound });
  }
}

/** Clamps `c.hp` to 0..`health.max` after adding `delta`. Health never kills by itself. */
export function changeHp(c: ChampionState, rules: Rules, delta: number): void {
  c.hp = Math.max(0, Math.min(rules.health.max, c.hp + delta));
}

/** Banks all unspent gold into items and restores full health; the champion is back next round. */
export function completeRecall(state: GameState, data: GameData, c: ChampionState, events: GameEvent[]): void {
  const itemsBought = c.gold;
  c.items += itemsBought;
  c.gold = 0;
  c.hp = data.rules.health.max;
  c.status = 'respawning';
  c.respawnRound = state.round + 1;
  events.push({ type: 'recall', champion: c.id, itemsBought });
}

/** At round start: dead champions whose timer is up become respawning, at full health. */
export function advanceRespawns(state: GameState, data: GameData): void {
  for (const c of state.champions) {
    if (c.status === 'dead' && c.respawnRound !== null && c.respawnRound <= state.round) {
      c.status = 'respawning';
      c.hp = data.rules.health.max;
    }
  }
}

export function teamScore(state: GameState, data: GameData, side: Side): number {
  const { objectives, verdict } = data.rules;
  let score = 0;
  for (const c of state.champions) if (c.side === side) score += c.goldEarned;
  for (const [id, n] of Object.entries(state.objectivesTaken[side])) {
    score += (n ?? 0) * objectives[id as keyof typeof objectives].value;
  }
  return score + state.platesTaken[side] * verdict.plateValue + state.towersDestroyed[side] * verdict.towerValue;
}

/** After the last round: ends the game and picks the higher team score, equal is a draw. */
export function finishIfOver(state: GameState, data: GameData): void {
  if (state.round <= totalRounds(data.rules)) return;
  state.over = true;
  const blue = teamScore(state, data, 'blue');
  const red = teamScore(state, data, 'red');
  state.winner = blue === red ? 'draw' : blue > red ? 'blue' : 'red';
}
