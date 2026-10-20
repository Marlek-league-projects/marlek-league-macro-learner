import mapJson from '../data/map.json';
import rulesJson from '../data/rules.json';
import aiProfilesJson from '../data/ai-profiles.json';
import teachingJson from '../data/teaching.json';
import { buildGraph } from './map';
import type { AiProfile, GameData, MapData, MistakeId, Rules, TeachingRule } from './types';

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

export function loadGameData(): GameData {
  const rules = rulesJson as Rules;
  const aiProfiles = aiProfilesJson as AiProfile[];
  const teaching = teachingJson as TeachingRule[];
  validateRules(rules);
  validateAiProfiles(aiProfiles);
  validateTeaching(teaching);
  const map = mapJson as MapData;
  return {
    map,
    graph: buildGraph(map),
    rules,
    champions: {},
    roster: [],
    matchups: [],
    duoMatchups: [],
    aiProfiles,
    teaching,
  };
}
