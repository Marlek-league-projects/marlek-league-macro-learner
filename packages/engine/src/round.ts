import type { GameData, Lane, Side } from '@lml/data/contracts';
import type { ChampionState, ContactChoices, GameEvent, GameState, Order, Orders, RoundResult } from './contracts';
import { detectContacts, gankedSide, playsSafe, resolveChoice } from './contacts';
import { advanceRespawns, applyKill, changeHp, completeRecall, finishIfOver } from './economy';
import { fightVictims, resolveFight } from './fight';
import { updateLanes } from './lanes';
import { budgetFrom, canAct, reachableFrom, retreatStep, validateOrders } from './movement';
import { captureObjectives, clearCamps, launchHeralds, spawnObjectives } from './objectives';
import { roundWindow } from './time';
import { spotByWards, updateVision } from './vision';

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
  /** Whether `c`, its move starting on `from`, has a step left on arrival at `to` (out of reach: no action left). */
  const actsAt = (c: ChampionState, from: string, to: string): boolean => {
    const budget = budgetFrom(data.rules, s.round, from, c.side);
    return canAct(reachableFrom(data, from, budget, c.side)[to] ?? budget, budget);
  };
  for (const c of s.champions) if (c.status !== 'respawning') c.previous = c.position;
  for (const { c, o } of steps) {
    if (o.stance !== undefined) c.stance = o.stance;
    if (o.kind === 'spawn') {
      // The spawn is a move from the base, with the base's extra steps.
      const base = `base-${c.side}`;
      c.position = o.to;
      c.previous = base;
      c.status = 'alive';
      c.respawnRound = null;
      events.push({ type: 'moved', champion: c.id, from: base, to: o.to, acted: actsAt(c, base, o.to) });
    } else if (o.to !== undefined && o.to !== c.position) {
      const acted = actsAt(c, c.position, o.to);
      events.push({ type: 'moved', champion: c.id, from: c.position, to: o.to, acted });
      c.position = o.to;
    }
  }
  /** Where each champion arrived, before any pull-in, flee or retreat. */
  const arrival: Record<string, string> = {};
  /** Champions with a step left on arrival: they act there, or wherever a lane fight pulls them. */
  const arrivedActing = new Set<string>();
  for (const c of s.champions) {
    if (c.status === 'respawning') continue;
    arrival[c.id] = c.position;
    if (actsAt(c, c.previous, c.position)) arrivedActing.add(c.id);
  }

  // 5. contacts
  const stage = roundWindow(data.rules, s.round).stage;
  const { fight: F } = data.rules;
  const fighters = new Set<string>();
  /** Fled, retreated (a fight's surviving losers) or caught in a fight while recalling: no action this round. */
  const forfeited = new Set<string>();
  /** Lost HP this round: no regeneration at its end. */
  const hurt = new Set<string>();
  const tradeWinners: Partial<Record<Lane, Side | null>> = {};
  /** Lanes whose uneven presence is not lane pressure: only a smaller side staying to farm farms at a reduced share. */
  const noPressure = new Set<Lane>();
  /** Lanes where a gank ended with no kill, by the side that won it (the ganked side fled, or lost without dying). */
  const gankWins: Partial<Record<Lane, Side>> = {};
  /** In a contested river without choosing the objective: no pit objective this round (the Scuttle is unaffected). */
  const offPit = new Set<string>();
  const loseHp = (id: string, amount: number): void => {
    const c = byId(id);
    const before = c.hp;
    changeHp(c, data.rules, -amount);
    hurt.add(id);
    if (before > c.hp) events.push({ type: 'hpLost', champion: id, amount: before - c.hp });
  };
  /** A tied fight: everyone goes back to where it stood (and acts there only if it had a step left on arrival). */
  const goBack = (ids: string[]): void => {
    for (const id of ids) byId(id).position = byId(id).previous;
  };
  /**
   * A decided fight: graded deaths among the `eligible` losers, then every losing survivor loses `fight.survivorLoss`
   * HP. In a gank, every surviving ganked champion loses `fight.gankHpLoss` instead (win or lose, never both).
   */
  const settle = (winner: Side, losers: string[], eligible: string[], gap: number, winners: string[], ganked: Side | null, lane: Lane | null): void => {
    const victims = fightVictims(s, data, eligible, gap);
    for (const id of losers) {
      if (!victims.includes(id) && other(winner) !== ganked) loseHp(id, F.survivorLoss);
    }
    if (ganked) {
      for (const id of ganked === winner ? winners : losers) {
        if (!victims.includes(id)) loseHp(id, F.gankHpLoss);
      }
    }
    if (ganked && lane && winner !== ganked && victims.length === 0) gankWins[lane] = winner;
    applyKill(s, data, victims, winners, events);
    // Surviving losers leave the spot to the winners, like a flee.
    retreat(losers);
  };
  /**
   * Flee movement: back to the previous position (the base for a champion who just spawned), or one step toward the
   * base for a champion who did not move and has nowhere to go back to. Dead champions stay where they are. Either
   * way, no action.
   */
  const retreat = (ids: string[]): void => {
    for (const id of ids) {
      const c = byId(id);
      if (c.status !== 'alive') continue;
      forfeited.add(id);
      c.position = c.previous === c.position ? retreatStep(data, c.side, c.position) : c.previous;
      events.push({ type: 'fled', champion: id, to: c.position });
    }
  };
  /** Champions staying in a prompted lane contact meet where the fight happens. */
  const pullIn = (ids: string[], position: string): void => {
    for (const id of ids) {
      const c = byId(id);
      if (c.position === position) continue;
      events.push({ type: 'moved', champion: id, from: c.position, to: position, acted: false });
      c.position = position;
    }
  };
  for (const contact of contacts) {
    const choice = resolveChoice(contact, choices);
    const lane = data.graph.positions[contact.position]!.lane ?? null;
    const ids: Record<Side, string[]> = { blue: contact.blue, red: contact.red };
    const n: Record<Side, number> = { blue: contact.blue.length, red: contact.red.length };
    const smaller: Side | null = n.blue < n.red ? 'blue' : n.red < n.blue ? 'red' : null;
    const defender = gankedSide(contact);
    const fleeing = SIDES.filter((side) => choice[side] === 'flee');
    // In a contested river, only a side keeping on the objective may start, continue or take the pit objective, and
    // only with the numbers on the pit once the contact is resolved (`captureObjectives`).
    if (contact.kind === 'objective') for (const side of SIDES) if (choice[side] !== 'objective') for (const id of ids[side]) offPit.add(id);
    if (lane && !contact.auto) {
      // Without a flee, both sides meet where the fight happens.
      if (fleeing.length === 0) for (const side of SIDES) pullIn(ids[side], contact.position);
      if (!(smaller && choice[smaller] === 'farm' && choice[other(smaller)] !== 'flee')) noPressure.add(lane);
    }
    if (fleeing.length > 0) {
      for (const side of fleeing) retreat(ids[side]);
      if (fleeing.length === 1) {
        const fled = fleeing[0]!;
        const stayed = other(fled);
        // Fleeing a side that commits to fight while outnumbered still costs HP.
        // A ganked side that flees leaves the gank (no kill) to the gankers, and pays `gankHpLoss` if they fight.
        const gankFled = fled === defender;
        if (gankFled && lane) gankWins[lane] = stayed;
        if (n[fled] < n[stayed] && choice[stayed] === 'fight') {
          for (const id of ids[fled]) loseHp(id, gankFled ? F.gankHpLoss : F.fleeHpLoss);
        }
        // In lane, the side that stayed wins the trade.
        if (lane) {
          tradeWinners[lane] = stayed;
          events.push({ type: 'trade', position: contact.position, lane, winner: stayed });
        }
      }
      continue;
    }
    if (!contact.auto && smaller && choice[smaller] === 'farm') {
      // The smaller side stays under its tower to farm: it dies only to a fight won by more than
      // `aiTuning.allInMargin`, otherwise it only loses `fight.pressureHpLoss`.
      const bigger = other(smaller);
      const { winner, scores } = resolveFight(s, data, contact.position, contact.blue, contact.red, stage, defender);
      const gap = scores[bigger] - scores[smaller];
      if (winner === bigger && gap > data.aiTuning.allInMargin) {
        events.push({ type: 'fight', position: contact.position, blue: contact.blue, red: contact.red, winner, scores });
        for (const id of [...contact.blue, ...contact.red]) fighters.add(id);
        settle(winner, ids[smaller], ids[smaller], gap, ids[bigger], defender, lane);
      } else {
        for (const id of ids[smaller]) loseHp(id, F.pressureHpLoss);
      }
      continue;
    }
    const focusing = SIDES.filter((side) => choice[side] === 'objective');
    if (focusing.length === 2) {
      // A race for the river objective: the higher fight score keeps taking it and the other side leaves, nobody
      // dies or loses HP. On a tie both stay: the numbers on the pit decide (`captureObjectives`).
      const { winner } = resolveFight(s, data, contact.position, contact.blue, contact.red, stage);
      if (winner) retreat(ids[other(winner)]);
      continue;
    }
    // Farm vs farm has no effect: the lane falls back to the fight-score push.
    if (choice.blue === 'farm' && choice.red === 'farm') continue;
    // A fight with deaths needs both sides on Trade or All-in and at least one All-in: Farm plays safe in an even
    // lane, so Farm against All-in is only a trade.
    const allIn = SIDES.some((side) => choice[side] === 'fight') && SIDES.every((side) => choice[side] !== 'farm');
    // A side that keeps taking the objective against a fight scores `fight.objectiveFocus` of its strength.
    const focus = Object.fromEntries(focusing.map((side) => [side, F.objectiveFocus]));
    const { winner, scores } = resolveFight(s, data, contact.position, contact.blue, contact.red, stage, defender, focus);
    if (!allIn) {
      tradeWinners[lane!] = winner;
      events.push({ type: 'trade', position: contact.position, lane: lane!, winner });
      if (winner !== null) {
        for (const id of ids[winner]) loseHp(id, data.rules.health.tradeWinnerLoss);
        for (const id of ids[other(winner)]) loseHp(id, data.rules.health.tradeLoss);
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
      settle(winner, losers, eligible, scores[winner] - scores[other(winner)], ids[winner], defender, lane);
    }
  }

  // 6. recalls not interrupted by a fight; an interrupted recall forfeits the action
  const recalled = new Set<string>();
  for (const { c, o } of steps) {
    if (o.kind !== 'recall' || c.status !== 'alive') continue;
    if (fighters.has(c.id)) forfeited.add(c.id);
    else {
      completeRecall(s, data, c, events);
      recalled.add(c.id);
    }
  }

  // 7-9. herald, camps, objectives, lanes
  launchHeralds(s, data, orders, events);
  // Only a champion with a step left on arrival (one who stayed always has it) who did not flee, retreat or have its
  // recall interrupted acts: clears its camp, takes its objective, farms its wave. A lane fight's pull-in or a tied
  // fight's way back neither gives nor takes that step.
  const acting = new Set(
    s.champions.filter((c) => c.status === 'alive' && !forfeited.has(c.id) && arrivedActing.has(c.id)).map((c) => c.id),
  );
  // `moved.acted` tells the result after contacts (a completed recall is the action).
  for (const e of events) if (e.type === 'moved') e.acted = acting.has(e.champion) || recalled.has(e.champion);
  clearCamps(s, data, acting, events);
  captureObjectives(s, data, events, acting, new Set([...acting].filter((id) => !offPit.has(id))));
  updateLanes(s, data, tradeWinners, events, noPressure, acting, gankWins);

  // 10. new wards
  for (const { c, o } of steps) {
    if (o.kind === 'spawn' || o.ward === undefined) continue;
    // A champion who did not end on its destination (fled, tied fight) cannot ward it.
    if (o.ward === 'to' && c.position !== o.to) continue;
    const position = typeof o.ward === 'object' ? o.ward.position : o.ward === 'from' ? c.previous : c.position;
    s.wards.push({ side: c.side, position, placedRound: s.round });
    events.push({ type: 'wardPlaced', side: c.side, position });
  }

  // 11. vision: wards spot enemies passing by, then what each side sees at the end of the round
  spotByWards(s, data, events, arrival);
  updateVision(s, data);

  // 12. health regeneration, then next round; `rngState` is carried over untouched for the AI
  // A champion who lost HP this round does not regenerate.
  for (const c of s.champions) {
    if (c.status === 'alive' && !hurt.has(c.id)) changeHp(c, data.rules, data.rules.health.regenPerRound);
  }
  s.round += 1;
  finishIfOver(s, data);
  if (!s.over) advanceRespawns(s, data);
  return { state: s, events };
}
