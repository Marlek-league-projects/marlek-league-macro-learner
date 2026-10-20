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
  moves: { laner: number; jungler: number; junglerObjectiveReach: boolean };
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
    /** Share of a solo laner's farm xp each bot laner gets while the support is in lane. */
    duoXpShare: number;
    /** Support's share of the lane farm gold. */
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
  /** Leaves an unpushed wave to rotate to a high-value objective when that gives the numbers. */
  waveSacrifice: boolean;
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
  /** Candidate order sets compared by the look-ahead. */
  lookaheadSets: number;
  /** Share of an objective's value the evaluation credits for our capture in progress (0..1). */
  captureShare: number;
  /** Share credited for standing on an objective that is up or about to spawn (0..1). */
  presenceShare: number;
  /** Fight-score margin over which an even lane contact is an all-in (and under whose negative it is fled). */
  allInMargin: number;
  /** Fight-score margin over which an even lane contact is traded instead of farmed. */
  tradeMargin: number;
  /** Objective value over which a laner leaves its unpushed wave to rotate to the pit, if that gives the numbers. */
  waveSacrificeCost: number;
  /** Game time (s): rounds starting before it are the laning phase, where laners only farm their wave, recall or take a paying rotation. */
  laningPhaseUntil: number;
  /** Candidate priorities, higher first. */
  priorities: Record<AiPriority, number>;
}

/** text uses {champion} {position} {n} {m} {objective} */
export interface TeachingRule {
  id: string;
  roundsLost: number;
  text: string;
}

/** French display names of objectives, used for the {objective} placeholder. */
export type ObjectiveNames = Record<ObjectiveId, string>;

export interface TeachingData {
  rules: TeachingRule[];
  objectiveNames: ObjectiveNames;
}
