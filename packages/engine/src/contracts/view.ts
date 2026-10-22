import type { Lane, Role, Side } from '@lml/data/contracts';
import type { ChampionState, GameState, MetRecord, Ward } from './state';

/** What a side knows about one enemy champion. */
export interface EnemyInfo {
  id: string;
  role: Role;
  /** Seen when the last round resolved. */
  visible: boolean;
  /** Current position when visible, otherwise the last seen one (or null). */
  position: string | null;
  lastSeenRound: number | null;
  /** Only known while visible. */
  level: number | null;
  /** Health, only known while visible. */
  hp: number | null;
  /** What the side learned meeting it in a contact, while it has not been seen since; null otherwise. */
  met: MetRecord | null;
}

/** What a side assumes an enemy has (fog of war: never its true lead), as the AI and lane pressure estimate it. */
export type EnemyEstimate = Pick<ChampionState, 'xp' | 'items' | 'bonusLead' | 'hp'>;

/** League-style (broadcast) scoreboard: all public, except `goldEarned`, the README-declared exception to the fog. */
export interface Scoreboard {
  kills: Record<Side, number>;
  towersDestroyed: Record<Side, number>;
  dragons: Record<Side, number>;
  barons: Record<Side, number>;
  heralds: Record<Side, number>;
  /** Voidgrubs camps taken (one per game at most). */
  voidgrubs: Record<Side, number>;
  /** Tower plates taken. */
  plates: Record<Side, number>;
  /** True team sum of gold earned, for the gold advantage. */
  goldEarned: Record<Side, number>;
}

/** The game as one side sees it through the fog of war. */
export interface PlayerView {
  side: Side;
  round: number;
  over: boolean;
  winner: GameState['winner'];
  allies: ChampionState[];
  enemies: EnemyInfo[];
  towers: GameState['towers'];
  waves: GameState['waves'];
  pits: GameState['pits'];
  scuttles: GameState['scuttles'];
  /** Camp timers as this side last saw them, own and enemy (an unseen clear leaves the old timer). */
  camps: GameState['camps'];
  /** Own wards only, the scuttle ward included (`scuttle: true`, on the scuttle). */
  wards: Ward[];
  grubs: GameState['grubs'];
  baronUntilRound: GameState['baronUntilRound'];
  objectivesTaken: GameState['objectivesTaken'];
  platesTaken: GameState['platesTaken'];
  towersDestroyed: GameState['towersDestroyed'];
  scoreboard: Scoreboard;
  /** Per lane, the side with lane pressure among the champions this side sees there; null on a tie or when a side is not seen. */
  pressure: Record<Lane, Side | null>;
}
