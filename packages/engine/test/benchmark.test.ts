import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import type { AiProfile, Rank } from '@lml/data/contracts';
import { aiContactChoice, aiOrders, createRng, defaultOrders, detectContacts, newGame, resolveRound, viewFor } from '@lml/engine';
import type { ContactChoices, Orders } from '@lml/engine/contracts';

/**
 * Difficulty sanity: blue idles (default orders and default contact choices) against the red AI.
 * Gold and above must win at least 15 of 20 seeds, Challenger all 20; Iron to Silver may lose.
 */
const d = loadGameData();
const SEEDS = 20;
const MIN_WINS: Partial<Record<Rank, number>> = {
  gold: 15, platinum: 15, emerald: 15, diamond: 15, master: 15, grandmaster: 15, challenger: 20,
};

function aiWinsAgainstIdle(p: AiProfile): number {
  let wins = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    let s = newGame(d, seed);
    const rng = createRng(seed + 1);
    while (!s.over) {
      const view = viewFor(s, d, 'red');
      const orders: Orders = { blue: defaultOrders(s, d, 'blue'), red: aiOrders(view, d, p, rng) };
      const choices: ContactChoices = {};
      for (const c of detectContacts(s, d, orders)) choices[c.id] = { red: aiContactChoice(view, d, c, p, rng) };
      s = resolveRound(s, d, orders, choices).state;
    }
    if (s.winner === 'red') wins++;
  }
  return wins;
}

describe('AI against an idle player', () => {
  for (const p of d.aiProfiles) {
    const min = MIN_WINS[p.rank];
    if (min === undefined) continue;
    test(`${p.rank} wins at least ${min}/${SEEDS}`, () => {
      expect(aiWinsAgainstIdle(p)).toBeGreaterThanOrEqual(min);
    }, 20_000);
  }
});
