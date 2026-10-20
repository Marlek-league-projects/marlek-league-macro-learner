import type { PerStage, Role } from './rules';

/** Champion data fetched from Data Dragon. */
export interface ChampionBase {
  id: string;
  name: string;
  image: string;
  tags: string[];
}

/** Hand-written ratings for a champion of the playable roster. */
export interface RosterEntry {
  id: string;
  roles: Role[];
  skirmish: PerStage;
  teamfight: PerStage;
  /** Junglers only. */
  clearSpeed?: number;
  waveclear: number;
}

/** Roster fields are present only for roster champions. */
export interface Champion extends ChampionBase, Partial<Omit<RosterEntry, 'id'>> {}

export type MatchupLane = 'top' | 'jungle' | 'mid' | 'adc' | 'support';

export interface Matchup {
  lane: MatchupLane;
  champion: string;
  opponent: string;
  advantage: PerStage;
  source: 'manual' | 'riot-api';
  patch: string;
}

export interface DuoMatchup {
  adc: string;
  support: string;
  opponentAdc: string;
  opponentSupport: string;
  advantage: PerStage;
  source: 'manual' | 'riot-api';
  patch: string;
}
