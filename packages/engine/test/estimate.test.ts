import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import type { AiProfile, Rank } from '@lml/data/contracts';
import {
  aiContactChoice,
  aiOrders,
  createEngine,
  createRng,
  detectContacts,
  estimateEnemy,
  newGame,
  resolveRound,
  totalRounds,
  viewFor,
} from '@lml/engine';
import type { ContactChoices, GameState, Orders } from '@lml/engine/contracts';

const d = loadGameData();
const profile = (rank: Rank): AiProfile => d.aiProfiles.find((p) => p.rank === rank)!;

describe('estimateEnemy', () => {
  function midGame(): GameState {
    const s = newGame(d, 3);
    s.round = 30;
    for (const c of s.champions) Object.assign(c, { xp: 4000, items: 2000, bonusLead: 0, goldEarned: 3000 });
    return s;
  }

  test('an unseen enemy is sized on its own-side mirror, items scaled by the scoreboard gold ratio', () => {
    const s = midGame();
    const blueMid = s.champions.find((c) => c.side === 'blue' && c.role === 'mid')!;
    blueMid.xp = 5000;
    blueMid.items = 2500;
    for (const c of s.champions) if (c.side === 'red') c.goldEarned = 4500; // red earned 1.5× blue's gold
    const view = viewFor(s, d, 'blue');
    const redMid = view.enemies.find((e) => e.role === 'mid')!;
    const est = estimateEnemy(view, d, { ...redMid, level: null });
    expect(est.xp).toBe(5000);
    expect(est.items).toBeCloseTo(2500 * 1.5);
  });

  test('a visible enemy shows the xp its level needs; dragons give the lead', () => {
    const s = midGame();
    s.objectivesTaken.red.dragon = 2;
    const view = viewFor(s, d, 'blue');
    const est = estimateEnemy(view, d, { role: 'top', level: 7 });
    expect(est.xp).toBe(d.rules.economy.levelXp[6]!);
    expect(est.bonusLead).toBe(2 * d.rules.buffs.dragonLead);
  });

  test('the engine surface exposes the same estimate', () => {
    const s = midGame();
    const view = viewFor(s, d, 'red');
    const e = view.enemies[0]!;
    expect(createEngine().estimateEnemy(view, d, e)).toEqual(estimateEnemy(view, d, e));
  });
});

describe('contested objectives', () => {
  /**
   * Regression: the old estimate gave every unseen enemy a full-time laner's farm (twice the real one mid-game), so
   * both AIs fled every contested pit, walked back to it and fled again for up to 18 rounds in a row.
   */
  test('AI vs AI: both sides never flee the same pit more than 2 rounds in a row', () => {
    for (const rank of ['challenger', 'diamond'] as Rank[]) {
      for (const seed of [1, 2, 3, 4, 5]) {
        let s = newGame(d, seed);
        const blue = createRng(seed);
        const red = createRng(seed + 1000);
        const run = new Map<string, number>();
        while (!s.winner && s.round <= totalRounds(d.rules)) {
          const orders: Orders = {
            blue: aiOrders(viewFor(s, d, 'blue'), d, profile(rank), blue),
            red: aiOrders(viewFor(s, d, 'red'), d, profile(rank), red),
          };
          const choices: ContactChoices = {};
          const mutual = new Set<string>();
          for (const c of detectContacts(s, d, orders)) {
            const choice = {
              blue: aiContactChoice(viewFor(s, d, 'blue'), d, c, profile(rank), blue),
              red: aiContactChoice(viewFor(s, d, 'red'), d, c, profile(rank), red),
            };
            choices[c.id] = choice;
            if (c.kind === 'objective' && choice.blue === 'flee' && choice.red === 'flee') mutual.add(c.position);
          }
          for (const p of [...run.keys()]) if (!mutual.has(p)) run.delete(p);
          for (const p of mutual) {
            run.set(p, (run.get(p) ?? 0) + 1);
            expect(`${rank} seed ${seed} round ${s.round} ${p}: ${run.get(p)}`).toBe(`${rank} seed ${seed} round ${s.round} ${p}: ${Math.min(2, run.get(p)!)}`);
          }
          s = resolveRound(s, d, orders, choices).state;
        }
      }
    }
  });
});
