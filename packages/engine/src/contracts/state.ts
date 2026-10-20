import type { Lane, ObjectiveId, Role, Side } from '@lml/data/contracts';

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  pick<T>(xs: T[]): T;
  state(): number;
}

/** -1 near blue frontmost tower, 1 near red frontmost tower. */
export type WavePos = -1 | 0 | 1;

export interface ChampionState {
  id: string;
  side: Side;
  role: Role;
  position: string;
  previous: string;
  status: 'alive' | 'respawning' | 'dead';
  respawnRound: number | null;
  xp: number;
  /** Unspent gold. */
  gold: number;
  items: number;
  bonusLead: number;
  goldEarned: number;
  hasHerald: boolean;
}

export interface Ward {
  side: Side;
  position: string;
  placedRound: number;
  scuttle?: boolean;
}

export interface PitState {
  objective: ObjectiveId | null;
  nextSpawn: number | null;
  capture: { side: Side; startedRound: number } | null;
}

export interface GameState {
  seed: number;
  rngState: number;
  /** 1..37 */
  round: number;
  over: boolean;
  champions: ChampionState[];
  /** Tower id to hp. */
  towers: Record<string, number>;
  waves: Record<Lane, WavePos>;
  /** Camp id to time (s) at which it is alive. */
  camps: Record<string, number>;
  scuttles: Record<'scuttle-top' | 'scuttle-bot', number>;
  pits: { 'baron-pit': PitState; 'dragon-pit': PitState };
  wards: Ward[];
  grubs: Record<Side, boolean>;
  baronUntilRound: Record<Side, number>;
  objectivesTaken: Record<Side, Partial<Record<ObjectiveId, number>>>;
  platesTaken: Record<Side, number>;
  towersDestroyed: Record<Side, number>;
  /** Per side, enemy champion id to last known position. */
  lastSeen: Record<Side, Record<string, { position: string; round: number } | null>>;
  winner: Side | 'draw' | null;
}
