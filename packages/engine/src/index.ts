import { createRng } from './rng';
import { roundWindow, totalRounds } from './time';
import { level, teamScore } from './economy';
import { aiAnswers, aiContactChoice, aiJoins, aiOrders } from './ai';
import type { GameEngine } from './contracts';
import { detectContacts } from './contacts';
import { canAct, defaultOrders, followsWave, isLaneChange, reachable, route, spawnPoints, stepBudget, stepBudgetFor, validateOrders } from './movement';
import { resolveRound } from './round';
import { newGame } from './setup';
import { aiPlacements, placeChampions, placementPositions } from './placement';
import { explainRound } from './teaching';
import { eventsFor, viewFor, wardRoundsLeft } from './vision';
import { estimateEnemy } from './estimate';

export const ENGINE_PACKAGE = '@lml/engine';
export { createRng } from './rng';
export { roundWindow, totalRounds } from './time';
export type { RoundWindow } from './time';
export { randomDraft, newGame } from './setup';
export { aiPlacements, placeChampions, placementPositions } from './placement';
export { budgetFrom, canAct, isLaneChange, moveStart, reachable, reachableFrom, route, spawnPoints, spawnPointsFor, stepBudget, stepBudgetFor, validateOrders, defaultOrders, followsWave } from './movement';
export { arrivalPositions, detectContacts, resolveChoice, resolveJoins, withJoiners } from './contacts';
export { lead, fightScore, resolveFight, gankModifier, fightVictims } from './fight';
export { damageTower, frontTower, laneExposure, lanePressure, towerMultiplier, updateLanes } from './lanes';
export { spawnObjectives, clearCamps, captureObjectives, launchHeralds } from './objectives';
export { level, applyKill, completeRecall, advanceRespawns, teamScore, finishIfOver } from './economy';
export { visibleEnemies, viewFor, eventsFor, spotByWards, wardRoundsLeft } from './vision';
export { resolveRound } from './round';
export { estimateEnemy } from './estimate';
export { explainRound } from './teaching';
export { aiOrders, aiContactChoice, aiJoins, aiAnswers, evaluate } from './ai';

export function createEngine(): GameEngine {
  return {
    newGame, placementPositions, placeChampions, aiPlacements, defaultOrders, followsWave, reachable, route, stepBudget, stepBudgetFor, canAct, isLaneChange, spawnPoints, validateOrders, detectContacts, resolveRound, viewFor, eventsFor, wardRoundsLeft, estimateEnemy,
    aiOrders, aiContactChoice, aiJoins, aiAnswers, explainRound, createRng, roundWindow, totalRounds, level, teamScore,
  };
}
