import { createRng } from './rng';
import { roundWindow, totalRounds } from './time';
import { level, teamScore } from './economy';
import { aiContactChoice, aiOrders } from './ai';
import type { GameEngine } from './contracts';
import { detectContacts } from './contacts';
import { defaultOrders, reachable, spawnPoints, validateOrders } from './movement';
import { resolveRound } from './round';
import { newGame } from './setup';
import { explainRound } from './teaching';
import { eventsFor, viewFor } from './vision';
import { estimateEnemy } from './estimate';

export const ENGINE_PACKAGE = '@lml/engine';
export { createRng } from './rng';
export { roundWindow, totalRounds } from './time';
export type { RoundWindow } from './time';
export { randomDraft, newGame } from './setup';
export { movesFor, reachable, reachableFrom, spawnPoints, spawnPointsFor, validateOrders, defaultOrders } from './movement';
export { arrivalPositions, detectContacts, resolveChoice } from './contacts';
export { lead, fightScore, resolveFight } from './fight';
export { damageTower, frontTower, lanePressure, towerMultiplier, updateLanes } from './lanes';
export { spawnObjectives, clearCamps, captureObjectives, launchHeralds } from './objectives';
export { level, applyKill, completeRecall, advanceRespawns, teamScore, finishIfOver } from './economy';
export { visibleEnemies, viewFor, eventsFor } from './vision';
export { resolveRound } from './round';
export { estimateEnemy } from './estimate';
export { explainRound } from './teaching';
export { aiOrders, aiContactChoice, evaluate } from './ai';

export function createEngine(): GameEngine {
  return {
    newGame, defaultOrders, reachable, spawnPoints, validateOrders, detectContacts, resolveRound, viewFor, eventsFor, estimateEnemy,
    aiOrders, aiContactChoice, explainRound, createRng, roundWindow, totalRounds, level, teamScore,
  };
}
