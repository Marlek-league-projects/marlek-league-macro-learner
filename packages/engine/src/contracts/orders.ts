import type { Stance } from './state';

/** `{position}` is only allowed in round 1, for the jungler, on enemy bluebuff/raptors. */
export type WardSpot = 'from' | 'to' | { position: string };

export type Order =
  | {
      kind: 'move';
      champion: string;
      to: string;
      ward?: WardSpot;
      unward?: 'from' | 'to';
      launchHerald?: boolean;
      /** Sets the champion's persistent stance. */
      stance?: Stance;
    }
  | {
      kind: 'recall';
      champion: string;
      /**
       * A position to move to first, at most the round's step budget minus 1 away (the recall is the action); the
       * recall happens there unless caught in a fight. `ward`/`unward` 'to' need it.
       */
      to?: string;
      ward?: 'from' | 'to';
      unward?: 'from' | 'to';
      stance?: Stance;
    }
  | { kind: 'spawn'; champion: string; to: string; stance?: Stance };

export interface Orders {
  blue: Order[];
  red: Order[];
}
