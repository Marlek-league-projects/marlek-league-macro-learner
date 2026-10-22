import type { AiProfile, GameData } from '@lml/data/contracts';
import type { Choice, Contact, ContactChoices, Order, PlayerView, Rng } from '../contracts';
import { createRng } from '../rng';
import { evaluate } from './evaluate';
import { assignStances, assignWards, bestOrders, candidateSets, contactChoice, joinChoice, makeContext, planCandidates, rollMistakes } from './heuristics';
import { simulate, type SimPolicy } from './simulate';

export { evaluate } from './evaluate';

/**
 * Orders for `view.side`: per champion, rank-dependent mistakes switch heuristic rules, then the best
 * candidate set is kept, or with `profile.lookahead` rounds of look-ahead the best of the top sets by `evaluate`.
 */
export function aiOrders(view: PlayerView, data: GameData, profile: AiProfile, rng: Rng): Order[] {
  if (view.over) return [];
  const mistakes = rollMistakes(view, profile, rng);
  const ctx = makeContext(view, data, profile.waveSacrifice);
  const sets = candidateSets(planCandidates(ctx, mistakes, rng), profile.lookahead > 0 ? data.aiTuning.lookaheadSets : 1);
  const finished = sets.map((set) => assignStances(ctx, assignWards(ctx, set, mistakes)));
  if (profile.lookahead === 0 || finished.length === 1) return finished[0]!;

  // The look-ahead plays mistake-free, so the policy never draws from an rng.
  const policy: SimPolicy = {
    orders: (v) => bestOrders(v, data, createRng(0), profile.waveSacrifice),
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

/** Contact choice for `view.side`, its own `joins` fighting with it; `chasingKills` is rolled once per contact. */
export function aiContactChoice(view: PlayerView, data: GameData, contact: Contact, profile: AiProfile, rng: Rng, joins: string[] = []): Choice {
  const chase = rng.next() < profile.mistakes.chasingKills;
  return contactChoice(view, data, contact, chase, joins);
}

/**
 * `view.side`'s champions joining a prompted contact from 1 step away (`joinChoice`), minus `taken` (already joining
 * another one). Rolling `joinFight` (once per contact with a possible joiner) inverts the decision: it ignores a
 * winning join, or sends every possible joiner into a fight it did not need or would not win.
 */
export function aiJoins(view: PlayerView, data: GameData, contact: Contact, profile: AiProfile, rng: Rng, taken: ReadonlySet<string> = new Set()): string[] {
  const mine = contact.nearby[view.side].filter((id) => !taken.has(id));
  if (mine.length === 0) return [];
  const good = joinChoice(view, data, contact, taken);
  if (rng.next() >= profile.mistakes.joinFight) return good;
  return good.length > 0 ? [] : mine;
}

/**
 * `view.side`'s answers to a round's contacts, in id order: per contact its joiners first (`aiJoins`, each champion
 * joining one contact at most), then its choice with them (`aiContactChoice`). Only `view.side`'s keys are set.
 */
export function aiAnswers(view: PlayerView, data: GameData, contacts: Contact[], profile: AiProfile, rng: Rng): ContactChoices {
  const side = view.side;
  const taken = new Set<string>();
  const out: ContactChoices = {};
  for (const c of contacts) {
    const joins = aiJoins(view, data, c, profile, rng, taken);
    for (const id of joins) taken.add(id);
    out[c.id] = { [side]: aiContactChoice(view, data, c, profile, rng, joins), joins: { [side]: joins } };
  }
  return out;
}
