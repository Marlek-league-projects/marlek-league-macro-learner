import { expect, test } from 'bun:test';
import { loadGameData, matchupAdvantage, validateChampions, validateMatchups } from '@lml/data';
import type { Matchup, RosterEntry, Stage } from '@lml/data';

const data = loadGameData();
const STAGES: Stage[] = [0, 1, 2, 3, 4];

test('champions are fetched and every roster id exists', () => {
  expect(Object.keys(data.champions).length).toBeGreaterThan(160);
  expect(data.roster).toHaveLength(30);
  for (const id of data.roster) expect(data.champions[id]).toBeDefined();
});

test('roster has 6 champions per role', () => {
  for (const role of ['top', 'jungle', 'mid', 'adc', 'support'] as const) {
    expect(data.roster.filter((id) => data.champions[id]!.roles?.includes(role))).toHaveLength(6);
  }
});

test('every rating array has 5 values in 0..10', () => {
  for (const id of data.roster) {
    const c = data.champions[id]!;
    for (const ratings of [c.skirmish, c.teamfight]) {
      expect(ratings).toHaveLength(5);
      for (const v of ratings!) expect(v >= 0 && v <= 10).toBe(true);
    }
    expect(c.waveclear! >= 0 && c.waveclear! <= 10).toBe(true);
  }
});

test('every jungler has clearSpeed', () => {
  for (const id of data.roster) {
    const c = data.champions[id]!;
    if (c.roles?.includes('jungle')) expect(typeof c.clearSpeed).toBe('number');
  }
});

test('matchups reference roster champions, stay in -5..+5 and have no duplicate pair', () => {
  expect(data.matchups).toHaveLength(75);
  expect(data.duoMatchups).toHaveLength(0);
  const seen = new Set<string>();
  for (const m of data.matchups) {
    expect(data.roster).toContain(m.champion);
    expect(data.roster).toContain(m.opponent);
    expect(m.advantage).toHaveLength(5);
    for (const v of m.advantage) expect(v >= -5 && v <= 5).toBe(true);
    const key = [m.champion, m.opponent].sort().join('|');
    expect(seen.has(key)).toBe(false);
    seen.add(key);
  }
});

test('matchupAdvantage reads stored rows and flips the sign when reversed', () => {
  const row = data.matchups.find((m) => m.lane === 'top')!;
  for (const stage of STAGES) {
    expect(matchupAdvantage(data, row.champion, row.opponent, stage)).toBe(row.advantage[stage]);
    expect(matchupAdvantage(data, row.opponent, row.champion, stage)).toBe(-row.advantage[stage]);
  }
  for (const m of data.matchups) {
    for (const stage of STAGES) {
      expect(matchupAdvantage(data, m.champion, m.opponent, stage)).toBe(
        -matchupAdvantage(data, m.opponent, m.champion, stage)!,
      );
    }
  }
});

test('matchupAdvantage is null when no row exists', () => {
  expect(matchupAdvantage(data, 'Darius', 'Kayle', 0)).toBeNull();
  expect(matchupAdvantage(data, 'Darius', 'Ahri', 2)).toBeNull();
});

test('validateChampions rejects bad roster entries', () => {
  const roster = structuredClone(data.roster.map((id) => ({ id, ...data.champions[id] }) as RosterEntry));
  const unknown = structuredClone(roster);
  unknown[0]!.id = 'NotAChampion';
  expect(() => validateChampions(data.champions, unknown)).toThrow(/roster/);
  const short = structuredClone(roster);
  short[0]!.skirmish = [1, 2, 3, 4] as unknown as RosterEntry['skirmish'];
  expect(() => validateChampions(data.champions, short)).toThrow(/roster/);
  const range = structuredClone(roster);
  range[0]!.teamfight[2] = 11;
  expect(() => validateChampions(data.champions, range)).toThrow(/roster/);
  const jungler = structuredClone(roster);
  delete jungler.find((r) => r.roles.includes('jungle'))!.clearSpeed;
  expect(() => validateChampions(data.champions, jungler)).toThrow(/clearSpeed/);
});

test('validateMatchups rejects bad rows', () => {
  const base = data.matchups[0]!;
  const reversed: Matchup = { ...base, champion: base.opponent, opponent: base.champion };
  expect(() => validateMatchups(data.roster, [base, reversed])).toThrow(/duplicate/);
  expect(() => validateMatchups(data.roster, [{ ...base, opponent: 'Kayle' }])).toThrow(/roster/);
  expect(() => validateMatchups(data.roster, [{ ...base, advantage: [6, 0, 0, 0, 0] }])).toThrow(/-5/);
});
