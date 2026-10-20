import type { Lane, ObjectiveId, Side } from '@lml/data/contracts';
import type { WavePos } from './state';

export type GameEvent =
  | { type: 'moved'; champion: string; from: string; to: string }
  | { type: 'fled'; champion: string; to: string }
  | { type: 'fight'; position: string; blue: string[]; red: string[]; winner: Side | null; scores: Record<Side, number> }
  | { type: 'trade'; position: string; lane: Lane; winner: Side | null }
  | { type: 'death'; champion: string; position: string; respawnRound: number }
  | { type: 'recall'; champion: string; itemsBought: number }
  | { type: 'wave'; lane: Lane; from: WavePos; to: WavePos }
  | { type: 'towerDamage'; tower: string; side: Side; damage: number; hp: number; destroyed: boolean }
  | { type: 'objectiveStarted' | 'objectiveTaken'; objective: ObjectiveId; side: Side; position: string; champions: string[] }
  | { type: 'campCleared'; camp: string; champion: string }
  | { type: 'wardPlaced' | 'wardCleared'; side: Side; position: string }
  | { type: 'heraldLaunched'; tower: string; side: Side };
