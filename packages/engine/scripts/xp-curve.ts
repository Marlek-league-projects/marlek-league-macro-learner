// Measures the XP curve: average champion level by role at fixed game times, Challenger AI against Challenger AI.
// Run after changing an XP source (waves, camps, kills, objectives) or the AI: `bun run xp-curve`.
import { loadGameData } from '@lml/data';
import type { Role, Side } from '@lml/data/contracts';
import { aiAnswers, aiOrders, aiPlacements, createRng, detectContacts, level, newGame, placeChampions, resolveRound, roundWindow, viewFor } from '../src';
import type { ContactChoices } from '../src/contracts';

const SEEDS = 10;
const MARKS = [180, 360, 600, 900, 1200, 1500];
const ROLES: Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];
// Orders of magnitude of a real game (playtest 9, decision 6), tolerance ±1 level.
const TARGETS: Record<Role, number[]> = {
  top: [4, 7, 10, 12, 14, 16],
  mid: [4, 7, 10, 12, 14, 16],
  jungle: [4, 6, 8.5, 11, 13, 15],
  adc: [3, 5.5, 8.5, 11, 13, 15],
  support: [3, 5, 7.5, 10, 12, 13.5],
};
const SIDES: Side[] = ['blue', 'red'];

const d = loadGameData();
const profile = d.aiProfiles.find((p) => p.rank === 'challenger')!;
const levels: Record<string, number[]> = {};

for (let seed = 1; seed <= SEEDS; seed++) {
  let s = newGame(d, seed);
  for (const side of SIDES) s = placeChampions(s, d, side, aiPlacements(viewFor(s, d, side), d));
  const rng = { blue: createRng(seed + 1), red: createRng(seed + 2) };
  while (!s.over) {
    const view = { blue: viewFor(s, d, 'blue'), red: viewFor(s, d, 'red') };
    const orders = { blue: aiOrders(view.blue, d, profile, rng.blue), red: aiOrders(view.red, d, profile, rng.red) };
    const contacts = detectContacts(s, d, orders);
    const answers = { blue: aiAnswers(view.blue, d, contacts, profile, rng.blue), red: aiAnswers(view.red, d, contacts, profile, rng.red) };
    const choices: ContactChoices = {};
    for (const c of contacts) {
      const b = answers.blue[c.id];
      const r = answers.red[c.id];
      choices[c.id] = { blue: b?.blue, red: r?.red, joins: { blue: b?.joins?.blue, red: r?.joins?.red } };
    }
    const end = roundWindow(d.rules, s.round).end;
    s = resolveRound(s, d, orders, choices).state;
    // The round whose window ends at or just after a mark.
    const mark = MARKS.find((m) => end >= m && end - 20 < m);
    if (mark !== undefined) for (const c of s.champions) (levels[`${c.role}@${mark}`] ??= []).push(level(c.xp, d.rules));
  }
}

const time = (m: number): string => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const avg = (xs: number[] = []): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
console.log(`Average level by role (${SEEDS} seeds, Challenger AI on both sides), measured / target; * = off by more than 1 level`);
console.log(['role'.padEnd(8), ...MARKS.map((m) => time(m).padStart(13))].join(''));
let off = 0;
for (const role of ROLES) {
  const cells = MARKS.map((m, i) => {
    const got = avg(levels[`${role}@${m}`]);
    const want = TARGETS[role][i]!;
    const miss = !(Math.abs(got - want) <= 1);
    if (miss) off++;
    return `${got.toFixed(1)} / ${want}${miss ? '*' : ' '}`.padStart(13);
  });
  console.log([role.padEnd(8), ...cells].join(''));
}
console.log(off === 0 ? 'All within ±1 level.' : `${off} cell(s) off by more than 1 level.`);
