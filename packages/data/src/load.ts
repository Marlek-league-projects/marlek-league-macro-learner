import mapJson from '../data/map.json';
import rulesJson from '../data/rules.json';
import aiProfilesJson from '../data/ai-profiles.json';
import aiTuningJson from '../data/ai-tuning.json';
import teachingJson from '../data/teaching.json';
import championsJson from '../data/champions.json';
import rosterJson from '../data/roster.json';
import matchupsJson from '../data/matchups.json';
import { buildGraph } from './map';
import type {
  AiPriority,
  AiProfile,
  AiTuning,
  Champion,
  ChampionBase,
  DuoMatchup,
  GameData,
  MapData,
  ObjectiveId,
  ObjectiveNames,
  Matchup,
  MistakeId,
  RosterEntry,
  Rules,
  Stage,
  TeachingData,
  TeachingRule,
} from './contracts';

/** Every mistake id, in the order the AI rolls them. */
export const MISTAKE_IDS: MistakeId[] = [
  'greed',
  'objectiveTiming',
  'pointlessPlay',
  'chasingKills',
  'rotateWithoutPriority',
  'badRecall',
  'poorVision',
  'noConversion',
  'ignoreJungler',
];

function fail(section: string, message: string): never {
  throw new Error(`${section}: ${message}`);
}

function checkPerStage(section: string, value: readonly number[]): void {
  if (!Array.isArray(value) || value.length !== 5) fail(section, 'expected 5 values (one per stage)');
}

export function validateRules(rules: Rules): void {
  const { phases } = rules;
  if (phases.length === 0) fail('rules.phases', 'no phases');
  phases.forEach((p, i) => {
    if (p.roundSeconds <= 0 || (p.end - p.start) % p.roundSeconds !== 0 || p.end <= p.start) {
      fail('rules.phases', `phase "${p.name}" length ${p.end - p.start}s is not divisible by roundSeconds ${p.roundSeconds}`);
    }
    const prev = phases[i - 1];
    if (prev && prev.end !== p.start) {
      fail('rules.phases', `gap between "${prev.name}" (ends ${prev.end}) and "${p.name}" (starts ${p.start})`);
    }
  });
  for (const p of phases) {
    const budget = rules.moves?.budgetBySeconds?.[String(p.roundSeconds)];
    if (typeof budget !== 'number' || !Number.isInteger(budget) || budget < 1) {
      fail('rules.moves', `budgetBySeconds has no positive integer step budget for ${p.roundSeconds}s rounds`);
    }
  }
  const duration = rules.wards?.duration;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1) {
    fail('rules.wards', `duration = ${String(duration)} is not a positive integer`);
  }
  checkPerStage('rules.towers.pushDamage', rules.towers.pushDamage);
  checkPerStage('rules.fight.numbers', rules.fight.numbers);
  const f = rules.fight;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!finite(f.deathGap) || f.deathGap <= 0) fail('rules.fight', `deathGap = ${String(f.deathGap)} is not a positive number`);
  for (const key of ['survivorLoss', 'gankExposed', 'gankHpLoss', 'pressureHpLoss', 'objectiveFocus'] as const) {
    if (!finite(f[key]) || f[key] < 0) fail('rules.fight', `${key} = ${String(f[key])} is not a non-negative number`);
  }
  const share = rules.economy.pressureFarmShare;
  if (typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 1) {
    fail('rules.economy', `pressureFarmShare = ${String(share)} is not a number in 0..1`);
  }
  const pushBonus = rules.lanes?.pushBonus;
  if (typeof pushBonus !== 'number' || !Number.isFinite(pushBonus) || pushBonus < 0) {
    fail('rules.lanes', `pushBonus = ${String(pushBonus)} is not a number >= 0`);
  }
  const h = rules.health;
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!h || !isNum(h.max) || h.max <= 0) fail('rules.health', 'max must be a positive number');
  for (const key of ['tradeLoss', 'tradeWinnerLoss', 'regenPerRound'] as const) {
    if (!isNum(h[key]) || h[key] < 0 || h[key] > h.max) fail('rules.health', `${key} = ${String(h[key])} is not a number in 0..${h.max}`);
  }
  if (!isNum(h.fightWeight) || h.fightWeight < 0 || h.fightWeight > 1) {
    fail('rules.health', `fightWeight = ${String(h.fightWeight)} is not a number in 0..1`);
  }
}

export function validateAiProfiles(profiles: AiProfile[]): void {
  for (const p of profiles) {
    for (const id of MISTAKE_IDS) {
      if (typeof p.mistakes[id] !== 'number') fail('aiProfiles', `profile "${p.rank}" is missing mistake "${id}"`);
    }
    if (typeof p.waveSacrifice !== 'boolean') fail('aiProfiles', `profile "${p.rank}" has no boolean waveSacrifice`);
  }
}

const AI_PRIORITIES: AiPriority[] = [
  'pointless', 'herald', 'objective', 'recall', 'convert', 'joinGank', 'lane',
  'gank', 'laneAlt', 'scuttle', 'buff', 'invade', 'camp', 'wait',
];

export function validateAiTuning(t: AiTuning): void {
  const num = (key: string, v: unknown, min: number, max = Infinity, integer = false): void => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      fail('aiTuning', `${key} = ${String(v)} is not ${integer ? 'an integer ' : 'a number '}in ${min}..${max}`);
    }
  };
  num('recallGold', t.recallGold, 0);
  num('recallHp', t.recallHp, 0);
  num('knownRounds', t.knownRounds, 0, Infinity, true);
  num('lookaheadSets', t.lookaheadSets, 1, Infinity, true);
  num('captureShare', t.captureShare, 0, 1);
  num('presenceShare', t.presenceShare, 0, 1);
  num('allInMargin', t.allInMargin, 0);
  num('tradeMargin', t.tradeMargin, 0);
  num('pushMargin', t.pushMargin, -Infinity);
  num('pushJunglerDistance', t.pushJunglerDistance, 0);
  num('waveSacrificeCost', t.waveSacrificeCost, 0);
  num('laningPhaseUntil', t.laningPhaseUntil, 0);
  for (const id of AI_PRIORITIES) num(`priorities.${id}`, t.priorities?.[id], -Infinity);
}

export function validateTeaching(rules: TeachingRule[]): void {
  for (const r of rules) {
    if (!r.text || r.text.trim() === '') fail('teaching', `rule "${r.id}" has empty text`);
  }
}

const OBJECTIVE_IDS: ObjectiveId[] = ['scuttle', 'dragon', 'voidgrubs', 'herald', 'baron'];

export function validateObjectiveNames(names: ObjectiveNames): void {
  for (const id of OBJECTIVE_IDS) {
    if (!names?.[id] || names[id].trim() === '') fail('teaching', `objectiveNames.${id} is missing or empty`);
  }
}

function checkRange(section: string, value: number | undefined, min: number, max: number): void {
  if (typeof value !== 'number' || value < min || value > max) fail(section, `value ${value} is not in ${min}..${max}`);
}

function checkRatings(section: string, value: readonly number[], min: number, max: number): void {
  checkPerStage(section, value);
  for (const v of value) checkRange(section, v, min, max);
}

export function validateChampions(champions: Record<string, ChampionBase>, roster: RosterEntry[]): void {
  for (const r of roster) {
    const section = `roster.${r.id}`;
    if (!champions[r.id]) fail(section, 'unknown champion id');
    if (!r.roles || r.roles.length === 0) fail(section, 'no roles');
    checkRatings(`${section}.skirmish`, r.skirmish, 0, 10);
    checkRatings(`${section}.teamfight`, r.teamfight, 0, 10);
    checkRange(`${section}.waveclear`, r.waveclear, 0, 10);
    if (r.roles.includes('jungle')) checkRange(`${section}.clearSpeed`, r.clearSpeed, 0, 10);
  }
}

export function validateMatchups(roster: string[], matchups: Matchup[]): void {
  const known = new Set(roster);
  const seen = new Set<string>();
  for (const m of matchups) {
    const section = `matchups.${m.champion}-${m.opponent}`;
    if (!known.has(m.champion) || !known.has(m.opponent)) fail(section, 'champion is not in the roster');
    if (m.champion === m.opponent) fail(section, 'champion plays against itself');
    checkRatings(`${section}.advantage`, m.advantage, -5, 5);
    const key = [m.champion, m.opponent].sort().join('|');
    if (seen.has(key)) fail(section, 'duplicate pair (in either direction)');
    seen.add(key);
  }
}

/** Advantage of `a` against `b` at `stage`, lane-agnostic; null when no row exists. */
export function matchupAdvantage(data: GameData, a: string, b: string, stage: Stage): number | null {
  for (const m of data.matchups) {
    if (m.champion === a && m.opponent === b) return m.advantage[stage];
    if (m.champion === b && m.opponent === a) return -m.advantage[stage];
  }
  return null;
}

export function loadGameData(): GameData {
  // The JSON has fixed `moves.budgetBySeconds` keys where Rules has any round length: `validateRules` checks it.
  const rules = rulesJson as unknown as Rules;
  const aiProfiles = aiProfilesJson as AiProfile[];
  const aiTuning = aiTuningJson as AiTuning;
  const { rules: teaching, objectiveNames } = teachingJson as TeachingData;
  validateRules(rules);
  validateAiProfiles(aiProfiles);
  validateAiTuning(aiTuning);
  validateTeaching(teaching);
  validateObjectiveNames(objectiveNames);
  const map = mapJson as MapData;
  const championList = championsJson as ChampionBase[];
  const roster = rosterJson as RosterEntry[];
  const { matchups, duoMatchups } = matchupsJson as unknown as { matchups: Matchup[]; duoMatchups: DuoMatchup[] };
  const champions: Record<string, Champion> = {};
  for (const c of championList) champions[c.id] = c;
  validateChampions(champions, roster);
  for (const { id, ...ratings } of roster) champions[id] = { ...champions[id]!, ...ratings };
  const rosterIds = roster.map((r) => r.id);
  validateMatchups(rosterIds, matchups);
  return {
    map,
    graph: buildGraph(map),
    rules,
    champions,
    roster: rosterIds,
    matchups,
    duoMatchups,
    aiProfiles,
    aiTuning,
    teaching,
    objectiveNames,
  };
}
