import type { Side } from '@lml/data/contracts';

/** `objective`: keep taking the river objective (offered on a contested river to a side acting on its pit or Scuttle). */
export type Choice = 'farm' | 'trade' | 'fight' | 'flee' | 'objective';
/**
 * `trade`: standard laning (automatic). `pressure`: uneven lane contact with nobody arriving from elsewhere. `gank`:
 * uneven lane contact with a champion of the bigger side arriving from elsewhere. `objective`: a river. `invade`: a
 * camp. `skirmish`: anything else in a lane.
 */
export type ContactKind = 'trade' | 'pressure' | 'gank' | 'objective' | 'invade' | 'skirmish';

export interface Contact {
  /** The zone: `lane-top` / `lane-mid` / `lane-bot`, `river-top` / `river-bot`, or the camp's position id. */
  id: string;
  /** Where the fight resolves. */
  position: string;
  /** The zone positions where involved champions arrived, sorted. */
  positions: string[];
  kind: ContactKind;
  /** Champion ids, sorted. */
  blue: string[];
  red: string[];
  options: Record<Side, Choice[]>;
  defaults: Record<Side, Choice>;
  /** Side entering an enemy camp, for `invade` contacts. */
  invader: Side | null;
  /** Resolved from the laners' stances, with no prompt: each side's only option is its default. */
  auto: boolean;
  /** HP of every champion in the contact: meeting there, each side sees the other's (contact = vision). */
  hp: Record<string, number>;
}

/** Contact id to the choices given so far. */
export type ContactChoices = Record<string, Partial<Record<Side, Choice>>>;
