import mapJson from '../data/map.json';
import rulesJson from '../data/rules.json';
import aiProfilesJson from '../data/ai-profiles.json';
import teachingJson from '../data/teaching.json';
import championsJson from '../data/champions.json';
import rosterJson from '../data/roster.json';
import matchupsJson from '../data/matchups.json';
import { buildGraph } from './map';
import type {
  AiProfile,
  Champion,
  ChampionBase,
  DuoMatchup,
  GameData,
  MapData,
  Matchup,
  MistakeId,
  RosterEntry,
  Rules,
  Stage,
  TeachingRule,
} from './types';

const MISTAKE_IDS: MistakeId[] = [
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
  checkPerStage('rules.towers.pushDamage', rules.towers.pushDamage);
  checkPerStage('rules.fight.numbers', rules.fight.numbers);
}

export function validateAiProfiles(profiles: AiProfile[]): void {
  for (const p of profiles) {
    for (const id of MISTAKE_IDS) {
      if (typeof p.mistakes[id] !== 'number') fail('aiProfiles', `profile "${p.rank}" is missing mistake "${id}"`);
    }
  }
}

export function validateTeaching(rules: TeachingRule[]): void {
  for (const r of rules) {
    if (!r.text || r.text.trim() === '') fail('teaching', `rule "${r.id}" has empty text`);
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
  const rules = rulesJson as Rules;
  const aiProfiles = aiProfilesJson as AiProfile[];
  const teaching = teachingJson as TeachingRule[];
  validateRules(rules);
  validateAiProfiles(aiProfiles);
  validateTeaching(teaching);
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
    teaching,
  };
}
