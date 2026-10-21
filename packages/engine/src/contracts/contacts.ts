import type { Side } from '@lml/data/contracts';

/** `objective`: keep taking the river objective (contested river). */
export type Choice = 'farm' | 'trade' | 'fight' | 'flee' | 'objective';
/** `trade`: even lane contact. `pressure`: uneven lane contact with nobody arriving from elsewhere. */
export type ContactKind = 'trade' | 'pressure' | 'gank' | 'objective' | 'invade' | 'skirmish';

export interface Contact {
  /** Zone id: `lane-top` / `lane-mid` / `lane-bot`, `river-top` / `river-bot`, or the camp's position id. */
  id: string;
  /** Where the fight resolves. */
  position: string;
  /** The zone positions where involved champions arrived, sorted. */
  positions?: string[];
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
}

/** Contact id to the choices given so far. */
export type ContactChoices = Record<string, Partial<Record<Side, Choice>>>;
