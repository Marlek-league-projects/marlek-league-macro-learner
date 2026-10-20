import type { AiProfile, Rules, TeachingRule } from './rules';
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
  teaching: TeachingRule[];
}

export interface GameDataSource {
  load(): GameData;
}
