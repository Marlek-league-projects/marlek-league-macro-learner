import type { AiProfile, AiTuning, ObjectiveNames, Rules, TeachingRule } from './rules';
import type { Champion, DuoMatchup, Matchup } from './champions';
import type { MapData, MapGraph } from './map';

export interface GameData {
  map: MapData;
  graph: MapGraph;
  rules: Rules;
  champions: Record<string, Champion>;
  roster: string[];
  matchups: Matchup[];
  duoMatchups: DuoMatchup[];
  aiProfiles: AiProfile[];
  aiTuning: AiTuning;
  teaching: TeachingRule[];
  objectiveNames: ObjectiveNames;
}

export interface GameDataSource {
  load(): GameData;
}
