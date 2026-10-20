import type { Stance } from './state';

/** `{position}` is only allowed in round 1, for the jungler, on enemy bluebuff/raptors. */
export type WardSpot = 'from' | 'to' | { position: string };

export type Order =
  | {
      kind: 'move';
      champion: string;
      to: string;
      via?: string;
      ward?: WardSpot;
      unward?: 'from' | 'to';
      launchHerald?: boolean;
      stance?: Stance;
    }
  /** `to`: an optional one-step move made before recalling. */
  | { kind: 'recall'; champion: string; ward?: 'from'; to?: string; stance?: Stance }
  | { kind: 'spawn'; champion: string; to: string };

export interface Orders {
  blue: Order[];
  red: Order[];
}
