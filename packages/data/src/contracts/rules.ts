export type Role = 'top' | 'jungle' | 'mid' | 'adc' | 'support';
export type Stage = 0 | 1 | 2 | 3 | 4;
export type PerStage = [number, number, number, number, number];

export type ObjectiveId = 'scuttle' | 'dragon' | 'voidgrubs' | 'herald' | 'baron';

export interface Phase {
  name: string;
  start: number;
  end: number;
  roundSeconds: number;
  stage: Stage;
}

export interface ObjectiveRule {
  firstSpawn: number;
  respawn: number | null;
  despawnAt: number | null;
  minChampions: number;
  extraRound: boolean;
  instantAt: number | null;
  gold: number;
  xp: number;
  value: number;
}

export interface Rules {
  phases: Phase[];
  moves: { laner: number; jungler: number };
  wards: { perRound: number; unwardPerRound: number; unwardRoles: Role[] };
  towers: {
    hp: number;
    pushDamage: number[];
    heraldDamage: number;
    platesGoldUntil: number;
    plateGold: number;
    towerGold: number;
    absentLanerChip: number;
  };
  buffs: { grubsMult: number; baronMult: number; baronRounds: number; dragonLead: number };
  objectives: Record<ObjectiveId, ObjectiveRule>;
  camps: {
    firstSpawn: number;
    buffRespawn: number;
    smallRespawn: number;
    buffGold: number;
    buffXp: number;
    smallGold: number;
    smallXp: number;
    fastClearAt: number;
  };
  economy: {
    farmGoldPerMin: number;
    farmXpPerMin: number;
    supportShare: number;
    passiveGoldPerMin: number;
    killGold: number;
    killXp: number;
    tradeLead: number;
    levelXp: number[];
  };
  fight: {
    numbers: PerStage;
    towerNumbersFactor: number;
    lead: number;
    matchup: number;
    strength: number;
    towerStrength: number;
    teamfightMinTotal: number;
  };
  death: { lateExtraRoundsFromStage: Stage; lateExtraRounds: number };
  verdict: { plateValue: number; towerValue: number };
}

export type MistakeId =
  | 'greed'
  | 'objectiveTiming'
  | 'pointlessPlay'
  | 'chasingKills'
  | 'rotateWithoutPriority'
  | 'badRecall'
  | 'poorVision'
  | 'noConversion'
  | 'ignoreJungler';

export type Rank =
  | 'iron'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'emerald'
  | 'diamond'
  | 'master'
  | 'grandmaster'
  | 'challenger';

export interface AiProfile {
  rank: Rank;
  label: string;
  mistakes: Record<MistakeId, number>;
  lookahead: 0 | 1 | 2;
}

export type AiPriority =
  | 'pointless'
  | 'herald'
  | 'objective'
  | 'recall'
  | 'convert'
  | 'joinGank'
  | 'lane'
  | 'gank'
  | 'laneAlt'
  | 'scuttle'
  | 'buff'
  | 'invade'
  | 'camp'
  | 'wait';

/** Weights and thresholds of the rule-based AI, shared by every rank. */
export interface AiTuning {
  /** Unspent gold that makes a recall worth it. */
  recallGold: number;
  /** An enemy seen at most this many rounds ago counts as known (its position is current). */
  knownRounds: number;
  /** Rounds an enemy laner seen in lane still counts as "was there" when converting a won fight. */
  convertMemoryRounds: number;
  /** A visible enemy within this distance of a pit blocks taking it. */
  pitThreatDistance: number;
  /** Candidate order sets compared by the look-ahead. */
  lookaheadSets: number;
  /** Share of an objective's value the evaluation credits for our capture in progress (0..1). */
  captureShare: number;
  /** Share credited for standing on an objective that is up or about to spawn (0..1). */
  presenceShare: number;
  /** Candidate priorities, higher first. */
  priorities: Record<AiPriority, number>;
}

/** text uses {champion} {position} {n} {m} {objective} */
export interface TeachingRule {
  id: string;
  roundsLost: number;
  text: string;
}
