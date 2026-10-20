import { expect, test } from 'bun:test';
import { loadGameData, validateAiProfiles, validateAiTuning, validateRules, validateObjectiveNames, validateTeaching } from '@lml/data';

const data = loadGameData();

test('phases give 37 rounds: 6, 8, 12, 6, 5', () => {
  const rounds = data.rules.phases.map((p) => (p.end - p.start) / p.roundSeconds);
  expect(rounds).toEqual([6, 8, 12, 6, 5]);
  expect(rounds.reduce((a, b) => a + b, 0)).toBe(37);
});

test('ai profiles: 10 ranks with scaled rates', () => {
  expect(data.aiProfiles).toHaveLength(10);
  const iron = data.aiProfiles.find((p) => p.rank === 'iron')!;
  const challenger = data.aiProfiles.find((p) => p.rank === 'challenger')!;
  expect(iron.mistakes.greed).toBe(0.6);
  expect(challenger.mistakes.greed).toBe(0.01);
  expect(challenger.mistakes.badRecall).toBeCloseTo(0.008, 10);
  expect(challenger.lookahead).toBe(2);
});

test('graph is built and teaching loaded', () => {
  expect(Object.keys(data.graph.positions)).toHaveLength(39);
  expect(data.teaching).toHaveLength(7);
});

test('validateRules rejects a phase gap', () => {
  const rules = structuredClone(data.rules);
  rules.phases[1]!.start += 20;
  expect(() => validateRules(rules)).toThrow(/phases/);
});

test('validateRules rejects non-divisible phase and bad PerStage', () => {
  const a = structuredClone(data.rules);
  a.phases[0]!.roundSeconds = 7;
  expect(() => validateRules(a)).toThrow(/phases/);
  const b = structuredClone(data.rules);
  b.fight.numbers = [1, 2, 3] as unknown as typeof b.fight.numbers;
  expect(() => validateRules(b)).toThrow(/fight\.numbers/);
});

test('validateAiTuning rejects bad tuning', () => {
  expect(() => validateAiTuning(data.aiTuning)).not.toThrow();
  const a = structuredClone(data.aiTuning);
  delete (a.priorities as Partial<Record<string, number>>).lane;
  expect(() => validateAiTuning(a)).toThrow(/aiTuning.*priorities\.lane/);
  const b = structuredClone(data.aiTuning);
  b.captureShare = 1.5;
  expect(() => validateAiTuning(b)).toThrow(/aiTuning.*captureShare/);
  const c = structuredClone(data.aiTuning);
  c.lookaheadSets = 0;
  expect(() => validateAiTuning(c)).toThrow(/aiTuning.*lookaheadSets/);
  const e = structuredClone(data.aiTuning);
  e.waveSacrificeCost = -1;
  expect(() => validateAiTuning(e)).toThrow(/aiTuning.*waveSacrificeCost/);
});

test('validateAiProfiles and validateTeaching reject bad data', () => {
  const profiles = structuredClone(data.aiProfiles);
  delete (profiles[0]!.mistakes as Partial<Record<string, number>>).greed;
  expect(() => validateAiProfiles(profiles)).toThrow(/aiProfiles.*greed/);
  const teaching = structuredClone(data.teaching);
  teaching[0]!.text = ' ';
  expect(() => validateTeaching(teaching)).toThrow(/teaching/);
});

test('objective names are loaded and validated', () => {
  expect(data.objectiveNames.scuttle).toBe('le Carapateur');
  const names = structuredClone(data.objectiveNames);
  names.baron = '';
  expect(() => validateObjectiveNames(names)).toThrow(/objectiveNames\.baron/);
});
