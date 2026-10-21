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

/** A laner's persistent posture in even lane contacts and lane pressure. */
export type Stance = 'push' | 'farm' | 'trade' | 'allin';

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
  /** Kept until an order changes it. */
  stance: Stance;
  /** Health, 0..`rules.health.max`: lost in trades, regained each round, full after a recall or a respawn. */
  hp: number;
}

/** Gives vision while rounds `placedRound + 1` … `placedRound + rules.wards.duration` resolve. */
export interface Ward {
  side: Side;
  position: string;
  placedRound: number;
  /** Put on the scuttle by taking it (never one of the round's order wards); also sees the scuttle's pit. */
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
  /** Per side, the scuttle timers as that side last saw them (its view never shows an unseen take). */
  scuttlesSeen: Record<Side, Record<'scuttle-top' | 'scuttle-bot', number>>;
  /** Per side, the camp timers as that side last saw them (its view never shows an unseen enemy invade). */
  campsSeen: Record<Side, Record<string, number>>;
  pits: { 'baron-pit': PitState; 'dragon-pit': PitState };
  wards: Ward[];
  grubs: Record<Side, boolean>;
  baronUntilRound: Record<Side, number>;
  objectivesTaken: Record<Side, Partial<Record<ObjectiveId, number>>>;
  platesTaken: Record<Side, number>;
  towersDestroyed: Record<Side, number>;
  /** Enemy champions each side has killed. */
  kills: Record<Side, number>;
  /**
   * Per side, enemy champion id to last known position. `spotted`: only seen passing an own ward that round, not
   * where it ended it (so not shown as visible).
   */
  lastSeen: Record<Side, Record<string, { position: string; round: number; spotted?: boolean } | null>>;
  winner: Side | 'draw' | null;
}
