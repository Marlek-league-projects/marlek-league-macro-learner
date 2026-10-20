import type { GameEngine } from './contracts';
import { detectContacts } from './contacts';
import { defaultOrders, reachable, spawnPoints, validateOrders } from './movement';
import { resolveRound } from './round';
import { newGame } from './setup';
import { viewFor } from './vision';

export const ENGINE_PACKAGE = '@lml/engine';
export { createRng } from './rng';
export { roundWindow, totalRounds } from './time';
export type { RoundWindow } from './time';
export { randomDraft, newGame } from './setup';
export { movesFor, reachable, spawnPoints, validateOrders, defaultOrders } from './movement';
export { arrivalPositions, detectContacts, resolveChoice } from './contacts';
export { lead, fightScore, resolveFight } from './fight';
export { damageTower, frontTower, towerMultiplier, updateLanes } from './lanes';
export { spawnObjectives, clearCamps, captureObjectives, launchHeralds } from './objectives';
export { level, applyKill, completeRecall, advanceRespawns, teamScore, finishIfOver } from './economy';
export { visibleEnemies, viewFor } from './vision';
export { resolveRound } from './round';

export function createEngine(): GameEngine {
  return { newGame, defaultOrders, reachable, spawnPoints, validateOrders, detectContacts, resolveRound, viewFor };
}
