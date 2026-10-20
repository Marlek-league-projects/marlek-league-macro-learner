import type { GameData, Lane, Side } from '@lml/data/contracts';
import type { ChampionState, ContactChoices, GameEvent, GameState, Order, Orders, RoundResult } from './contracts';
import { detectContacts, resolveChoice } from './contacts';
import { advanceRespawns, applyKill, completeRecall, finishIfOver } from './economy';
import { resolveFight } from './fight';
import { updateLanes } from './lanes';
import { validateOrders } from './movement';
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
  advanceRespawns(s);
  spawnObjectives(s, data);

  // 3. unwards, on the target position before moving
  for (const { c, o } of steps) {
    if (o.kind !== 'move' || !o.unward) continue;
    const at = o.unward === 'from' ? c.position : o.to;
    const enemy = other(c.side);
    for (const w of s.wards.filter((x) => x.side === enemy && x.position === at)) {
      events.push({ type: 'wardCleared', side: enemy, position: at });
    }
    s.wards = s.wards.filter((x) => !(x.side === enemy && x.position === at));
  }

  // 4. moves and spawns; contacts come from the input state, where only ordered champions are on the map
  const contacts = detectContacts(state, data, orders);
  for (const c of s.champions) if (c.status !== 'respawning') c.previous = c.position;
  for (const { c, o } of steps) {
    if (o.kind === 'spawn') {
      c.position = o.to;
      c.previous = o.to;
      c.status = 'alive';
      c.respawnRound = null;
      events.push({ type: 'moved', champion: c.id, from: `base-${c.side}`, to: o.to });
    } else if (o.kind === 'move' && o.to !== c.position) {
      events.push({ type: 'moved', champion: c.id, from: c.position, to: o.to });
      c.position = o.to;
    }
  }

  // 5. contacts
  const stage = roundWindow(data.rules, s.round).stage;
  const fighters = new Set<string>();
  const tradeWinners: Partial<Record<Lane, Side | null>> = {};
  const goBack = (ids: string[]): void => {
    for (const id of ids) byId(id).position = byId(id).previous;
  };
  for (const contact of contacts) {
    const choice = resolveChoice(contact, choices);
    const ids: Record<Side, string[]> = { blue: contact.blue, red: contact.red };
    const fleeing = SIDES.filter((side) => choice[side] === 'flee');
    if (fleeing.length > 0) {
      for (const side of fleeing) {
        goBack(ids[side]);
        for (const id of ids[side]) events.push({ type: 'fled', champion: id, to: byId(id).position });
      }
      continue;
    }
    const { winner, scores } = resolveFight(s, data, contact.position, contact.blue, contact.red, stage);
    if (choice.blue === 'trade' && choice.red === 'trade') {
      const lane = data.graph.positions[contact.position]!.lane!;
      tradeWinners[lane] = winner;
      events.push({ type: 'trade', position: contact.position, lane, winner });
      continue;
    }
    events.push({ type: 'fight', position: contact.position, blue: contact.blue, red: contact.red, winner, scores });
    for (const id of [...contact.blue, ...contact.red]) fighters.add(id);
    if (winner === null) {
      goBack([...contact.blue, ...contact.red]);
    } else {
      applyKill(s, data, ids[other(winner)], ids[winner], events);
    }
  }

  // 6. recalls not interrupted by a fight
  for (const { c, o } of steps) {
    if (o.kind === 'recall' && c.status === 'alive' && !fighters.has(c.id)) completeRecall(s, c, events);
  }

  // 7-9. herald, camps, objectives, lanes
  launchHeralds(s, data, orders, events);
  const viaById: Record<string, string | undefined> = {};
  for (const { c, o } of steps) {
    if (o.kind === 'move' && o.via && c.position === o.to) viaById[c.id] = o.via;
  }
  clearCamps(s, data, viaById, events);
  captureObjectives(s, data, events);
  updateLanes(s, data, tradeWinners, events);

  // 10. new wards
  for (const { c, o } of steps) {
    if (o.kind === 'spawn' || o.ward === undefined) continue;
    const position = typeof o.ward === 'object' ? o.ward.position : o.ward === 'from' ? c.previous : c.position;
    s.wards.push({ side: c.side, position, placedRound: s.round });
    events.push({ type: 'wardPlaced', side: c.side, position });
  }

  // 11. vision
  updateVision(s, data);

  // 12. next round; `rngState` is carried over untouched for the AI
  s.round += 1;
  finishIfOver(s, data);
  if (!s.over) advanceRespawns(s);
  return { state: s, events };
}
