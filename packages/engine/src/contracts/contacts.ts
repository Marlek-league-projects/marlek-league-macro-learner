import type { Side } from '@lml/data/contracts';

export type Choice = 'farm' | 'trade' | 'fight' | 'flee';
/** `trade`: even lane contact. `pressure`: uneven lane contact with nobody arriving from elsewhere. */
export type ContactKind = 'trade' | 'pressure' | 'gank' | 'objective' | 'invade' | 'skirmish';

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
  /** Resolved from the laners' stances, with no prompt: each side's only option is its default. */
  auto: boolean;
}

/** Contact id to the choices given so far. */
export type ContactChoices = Record<string, Partial<Record<Side, Choice>>>;
