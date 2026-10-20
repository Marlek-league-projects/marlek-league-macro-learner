export const DATA_PACKAGE = '@lml/data';
export * from './types';
export { buildGraph, mirrorId } from './map';
export {
  loadGameData,
  matchupAdvantage,
  validateRules,
  validateAiProfiles,
  validateTeaching,
  validateChampions,
  validateMatchups,
} from './load';
