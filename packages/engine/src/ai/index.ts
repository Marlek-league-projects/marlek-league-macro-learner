import type { AiProfile, GameData } from '@lml/data/contracts';
import type { Choice, Contact, Order, PlayerView, Rng } from '../contracts';
import { createRng } from '../rng';
import { evaluate } from './evaluate';
import { assignWards, bestOrders, candidateSets, contactChoice, makeContext, planCandidates, rollMistakes } from './heuristics';
import { simulate, type SimPolicy } from './simulate';

export { evaluate } from './evaluate';

/**
 * Orders for `view.side`: per champion, rank-dependent mistakes switch heuristic rules, then the best
 * candidate set is kept, or with `profile.lookahead` rounds of look-ahead the best of the top sets by `evaluate`.
 */
export function aiOrders(view: PlayerView, data: GameData, profile: AiProfile, rng: Rng): Order[] {
  if (view.over) return [];
  const mistakes = rollMistakes(view, profile, rng);
  const ctx = makeContext(view, data);
  const sets = candidateSets(planCandidates(ctx, mistakes, rng), profile.lookahead > 0 ? data.aiTuning.lookaheadSets : 1);
  const finished = sets.map((set) => assignWards(ctx, set, mistakes));
  if (profile.lookahead === 0 || finished.length === 1) return finished[0]!;

  // The look-ahead plays mistake-free, so the policy never draws from an rng.
  const policy: SimPolicy = {
    orders: (v) => bestOrders(v, data, createRng(0)),
    choice: (v, contact) => contactChoice(v, data, contact, false),
  };
  let best = finished[0]!;
  let bestScore = -Infinity;
  for (const orders of finished) {
    const score = evaluate(simulate(view, data, orders, profile.lookahead, policy), data);
    if (score > bestScore) {
      best = orders;
      bestScore = score;
    }
  }
  return best;
}

/** Contact choice for `view.side`; `chasingKills` is rolled once per contact. */
export function aiContactChoice(view: PlayerView, data: GameData, contact: Contact, profile: AiProfile, rng: Rng): Choice {
  const chase = rng.next() < profile.mistakes.chasingKills;
  return contactChoice(view, data, contact, chase);
}
