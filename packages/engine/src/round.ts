import type { GameData, Lane, Side } from '@lml/data/contracts';
import type { ChampionState, ContactChoices, GameEvent, GameState, Order, Orders, RoundResult } from './contracts';
import { detectContacts, gankedSide, playsSafe, resolveChoice } from './contacts';
import { advanceRespawns, applyKill, changeHp, completeRecall, finishIfOver } from './economy';
import { fightVictims, resolveFight } from './fight';
import { updateLanes } from './lanes';
import { canAct, reachableFrom, retreatStep, stepBudget, validateOrders } from './movement';
import { captureObjectives, clearCamps, launchHeralds, spawnObjectives } from './objectives';
import { roundWindow } from './time';
import { updateVision } from './vision';

const SIDES: Side[] = ['blue', 'red'];
const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');

type Step = { c: ChampionState; o: Order };

/**
 * Resolves one round on a copy of `state`: orders, contacts, recalls, herald, camps and objectives,
 * lanes, wards and vision, then advances the round. Never mutates its inputs.
 */
export function resolveRound(state: GameState, data: GameData, orders: Orders, choices: ContactChoices): RoundResult {
  // 1. guard and validation
  if (state.over) throw new Error('game is over');
  for (const side of SIDES) validateOrders(state, data, side, orders[side]);

  const s = structuredClone(state);
  const events: GameEvent[] = [];
  const byId = (id: string): ChampionState => s.champions.find((c) => c.id === id)!;
  const steps: Step[] = SIDES.flatMap((side) => orders[side].map((o) => ({ c: byId(o.champion), o })));

  // 2. round start
  advanceRespawns(s, data);
  spawnObjectives(s, data);

  // 3. unwards, on the target position before moving
  for (const { c, o } of steps) {
    if (o.kind === 'spawn' || !o.unward) continue;
    const at = o.unward === 'from' ? c.position : o.to!;
    const enemy = other(c.side);
    for (const w of s.wards.filter((x) => x.side === enemy && x.position === at)) {
      events.push({ type: 'wardCleared', side: enemy, position: at });
    }
    s.wards = s.wards.filter((x) => !(x.side === enemy && x.position === at));
  }

  // 4. moves and spawns; contacts come from the input state, where only ordered champions are on the map
  const contacts = detectContacts(state, data, orders);
  const budget = stepBudget(data.rules, s.round);
  /** Steps from `from` to `to` this round (`budget` when out of reach: no action left). */
  const stepsTo = (c: ChampionState, from: string, to: string): number => reachableFrom(data, from, budget, c.side)[to] ?? budget;
  for (const c of s.champions) if (c.status !== 'respawning') c.previous = c.position;
  for (const { c, o } of steps) {
    if (o.stance !== undefined) c.stance = o.stance;
    if (o.kind === 'spawn') {
      c.position = o.to;
      c.previous = o.to;
      c.status = 'alive';
      c.respawnRound = null;
      events.push({ type: 'moved', champion: c.id, from: `base-${c.side}`, to: o.to, acted: true });
    } else if (o.to !== undefined && o.to !== c.position) {
      const acted = canAct(stepsTo(c, c.position, o.to), budget);
      events.push({ type: 'moved', champion: c.id, from: c.position, to: o.to, acted });
      c.position = o.to;
    }
  }

  // 5. contacts
  const stage = roundWindow(data.rules, s.round).stage;
  const fighters = new Set<string>();
  const tradeWinners: Partial<Record<Lane, Side | null>> = {};
  const ganked = new Set<Lane>();
  const goBack = (ids: string[]): void => {
    for (const id of ids) byId(id).position = byId(id).previous;
  };
  /**
   * A decided fight: graded deaths among the `eligible` losers, then every losing survivor loses `fight.survivorLoss`
   * HP. In a gank, every surviving ganked champion loses `fight.gankHpLoss` instead (win or lose, never both).
   */
  const settle = (winner: Side, losers: string[], eligible: string[], gap: number, winners: string[], ganked: Side | null): void => {
    const victims = fightVictims(s, data, eligible, gap);
    const { survivorLoss, gankHpLoss } = data.rules.fight;
    for (const id of losers) {
      if (!victims.includes(id) && other(winner) !== ganked) changeHp(byId(id), data.rules, -survivorLoss);
    }
    if (ganked) {
      for (const id of ganked === winner ? winners : losers) {
        if (!victims.includes(id)) changeHp(byId(id), data.rules, -gankHpLoss);
      }
    }
    applyKill(s, data, victims, winners, events);
    // Surviving losers leave the spot to the winners, like a flee.
    retreat(losers);
  };
  /**
   * Flee movement: back to the previous position, or one step toward the base for a champion who did not move (or
   * just spawned here) and has nowhere to go back to. Dead champions stay where they are.
   */
  const retreat = (ids: string[]): void => {
    for (const id of ids) {
      const c = byId(id);
      if (c.status !== 'alive') continue;
      c.position = c.previous === c.position ? retreatStep(data, c.side, c.position) : c.previous;
      events.push({ type: 'fled', champion: id, to: c.position });
    }
  };
  for (const contact of contacts) {
    const choice = resolveChoice(contact, choices);
    const contactLane = data.graph.positions[contact.position]!.lane;
    if (contact.kind === 'gank' && contactLane) ganked.add(contactLane);
    const ids: Record<Side, string[]> = { blue: contact.blue, red: contact.red };
    const defender = gankedSide(contact);
    const fleeing = SIDES.filter((side) => choice[side] === 'flee');
    if (fleeing.length > 0) {
      for (const side of fleeing) retreat(ids[side]);
      // Fleeing a gank the gankers committed to still costs HP.
      if (defender && fleeing.length === 1 && fleeing[0] === defender) {
        for (const id of ids[defender]) changeHp(byId(id), data.rules, -data.rules.fight.gankHpLoss);
      }
      // In lane, the side that stayed (to trade or fight) wins the trade.
      const lane = data.graph.positions[contact.position]!.lane;
      if (fleeing.length === 1 && lane) {
        const winner = other(fleeing[0]!);
        tradeWinners[lane] = winner;
        events.push({ type: 'trade', position: contact.position, lane, winner });
      }
      continue;
    }
    if (contact.kind === 'pressure') {
      // The lone side only farms: it can die only to an All-in won by more than `aiTuning.allInMargin`.
      const bigger: Side = contact.blue.length > contact.red.length ? 'blue' : 'red';
      if (choice[bigger] !== 'fight') continue;
      const { winner, scores } = resolveFight(s, data, contact.position, contact.blue, contact.red, stage);
      const gap = scores[bigger] - scores[other(bigger)];
      if (winner !== bigger || gap <= data.aiTuning.allInMargin) continue;
      events.push({ type: 'fight', position: contact.position, blue: contact.blue, red: contact.red, winner, scores });
      for (const id of [...contact.blue, ...contact.red]) fighters.add(id);
      settle(winner, ids[other(winner)], ids[other(winner)], gap, ids[winner], null);
      continue;
    }
    // Farm vs farm has no effect: the lane falls back to the fight-score push.
    if (choice.blue === 'farm' && choice.red === 'farm') continue;
    // A fight with deaths needs both sides on Trade or All-in and at least one All-in: Farm plays safe in an even
    // lane, so Farm against All-in is only a trade (prompted contacts never offer Farm).
    const allIn = SIDES.some((side) => choice[side] === 'fight') && SIDES.every((side) => choice[side] !== 'farm');
    const { winner, scores } = resolveFight(s, data, contact.position, contact.blue, contact.red, stage, defender);
    if (!allIn) {
      const lane = data.graph.positions[contact.position]!.lane!;
      tradeWinners[lane] = winner;
      events.push({ type: 'trade', position: contact.position, lane, winner });
      if (winner !== null) {
        for (const id of ids[winner]) changeHp(byId(id), data.rules, -data.rules.health.tradeWinnerLoss);
        for (const id of ids[other(winner)]) changeHp(byId(id), data.rules, -data.rules.health.tradeLoss);
      }
      continue;
    }
    events.push({ type: 'fight', position: contact.position, blue: contact.blue, red: contact.red, winner, scores });
    for (const id of [...contact.blue, ...contact.red]) fighters.add(id);
    if (winner === null) {
      goBack([...contact.blue, ...contact.red]);
    } else {
      // Farm and Push are per champion: in an even lane, a loser playing safe is never a victim (it only loses HP as
      // a survivor).
      const losers = ids[other(winner)];
      const eligible = contact.kind === 'trade' ? losers.filter((id) => !playsSafe(byId(id).stance)) : losers;
      settle(winner, losers, eligible, scores[winner] - scores[other(winner)], ids[winner], defender);
    }
  }

  // 6. recalls not interrupted by a fight
  for (const { c, o } of steps) {
    if (o.kind === 'recall' && c.status === 'alive' && !fighters.has(c.id)) completeRecall(s, data, c, events);
  }

  // 7-9. herald, camps, objectives, lanes
  launchHeralds(s, data, orders, events);
  // Only a champion with a step left where it stands acts: clears its camp, takes its objective, farms its wave.
  const acting = new Set(
    s.champions.filter((c) => c.status === 'alive' && canAct(stepsTo(c, c.previous, c.position), budget)).map((c) => c.id),
  );
  clearCamps(s, data, acting, events);
  captureObjectives(s, data, events, acting);
  updateLanes(s, data, tradeWinners, events, ganked, acting);

  // 10. new wards
  for (const { c, o } of steps) {
    if (o.kind === 'spawn' || o.ward === undefined) continue;
    // A champion who did not end on its destination (fled, tied fight) cannot ward it.
    if (o.ward === 'to' && c.position !== o.to) continue;
    const position = typeof o.ward === 'object' ? o.ward.position : o.ward === 'from' ? c.previous : c.position;
    s.wards.push({ side: c.side, position, placedRound: s.round });
    events.push({ type: 'wardPlaced', side: c.side, position });
  }

  // 11. vision
  updateVision(s, data);

  // 12. health regeneration, then next round; `rngState` is carried over untouched for the AI
  for (const c of s.champions) if (c.status === 'alive') changeHp(c, data.rules, data.rules.health.regenPerRound);
  s.round += 1;
  finishIfOver(s, data);
  if (!s.over) advanceRespawns(s, data);
  return { state: s, events };
}
