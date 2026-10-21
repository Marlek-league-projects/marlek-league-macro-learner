import type { Lane, ObjectiveId, Side } from '@lml/data/contracts';
import type { WavePos } from './state';

export type GameEvent =
  /** `acted`: the move left a step for an action at `to` (clear its camp, take its objective, farm its wave). */
  | { type: 'moved'; champion: string; from: string; to: string; acted: boolean }
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
  /**
   * An enemy `champion`'s route this round crossed what `side`'s ward on `position` sees. `to`: where it ended the
   * round when `side` sees it there, else null. Only `side` sees this event.
   */
  | { type: 'wardSpotted'; side: Side; position: string; champion: string; to: string | null }
  | { type: 'heraldLaunched'; tower: string; side: Side }
  /** HP actually lost (after clamping at 0). */
  | { type: 'hpLost'; champion: string; amount: number };
