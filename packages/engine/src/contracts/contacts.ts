import type { Side } from '@lml/data/contracts';

export type Choice = 'farm' | 'trade' | 'fight' | 'flee';
export type ContactKind = 'trade' | 'gank' | 'objective' | 'invade' | 'skirmish';

export interface Contact {
  /** Same as `position`: at most one contact per position. */
  id: string;
  position: string;
  kind: ContactKind;
  /** Champion ids, sorted. */
  blue: string[];
  red: string[];
  options: Record<Side, Choice[]>;
  defaults: Record<Side, Choice>;
  /** Side entering an enemy camp, for `invade` contacts. */
  invader: Side | null;
}

/** Contact id to the choices given so far. */
export type ContactChoices = Record<string, Partial<Record<Side, Choice>>>;
