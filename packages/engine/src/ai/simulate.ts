import { mirrorId } from '@lml/data';
import type { GameData } from '@lml/data/contracts';
import type { ChampionState, Choice, Contact, ContactChoices, GameState, Order, Orders, PlayerView } from '../contracts';
import { detectContacts } from '../contacts';
import { defaultOrders } from '../movement';
import { resolveRound } from '../round';
import { viewFor } from '../vision';
import { estimateEnemy, other } from './evaluate';

/**
 * A full state built from what `view.side` knows: its own champions as they are, enemies alive at their
 * last seen position (their base if never seen, or not seen within `aiTuning.knownRounds`) with estimated stats,
 * enemy camps mirroring ours.
 */
export function stateFromView(view: PlayerView, data: GameData): GameState {
  const enemy = other(view.side);
  const enemies: ChampionState[] = view.enemies.map((e) => {
    const est = estimateEnemy(view, data, e);
    const current = e.position !== null && e.lastSeenRound !== null && view.round - e.lastSeenRound <= data.aiTuning.knownRounds;
    const position = current ? e.position! : `base-${enemy}`;
    return {
      id: e.id, side: enemy, role: e.role, position, previous: position, status: 'alive', respawnRound: null,
      xp: est.xp, gold: 0, items: est.items, bonusLead: est.bonusLead, goldEarned: est.items, hasHerald: false,
    };
  });
  const camps = { ...view.camps };
  for (const [id, t] of Object.entries(view.camps)) camps[mirrorId(id)] = t;
  const lastSeen: GameState['lastSeen'] = { blue: {}, red: {} };
  for (const e of view.enemies) {
    lastSeen[view.side][e.id] =
      e.position !== null && e.lastSeenRound !== null ? { position: e.position, round: e.lastSeenRound } : null;
  }
  for (const a of view.allies) lastSeen[enemy][a.id] = null;
  const champions = view.side === 'blue' ? [...view.allies, ...enemies] : [...enemies, ...view.allies];
  return structuredClone({
    seed: 0,
    rngState: 0,
    round: view.round,
    over: view.over,
    champions,
    towers: view.towers,
    waves: view.waves,
    camps,
    scuttles: view.scuttles,
    scuttlesSeen: { blue: view.scuttles, red: view.scuttles },
    campsSeen: { blue: camps, red: camps },
    pits: view.pits,
    wards: view.wards,
    grubs: view.grubs,
    baronUntilRound: view.baronUntilRound,
    objectivesTaken: view.objectivesTaken,
    platesTaken: view.platesTaken,
    towersDestroyed: view.towersDestroyed,
    lastSeen,
    winner: view.winner,
  });
}

export interface SimPolicy {
  orders(view: PlayerView): Order[];
  choice(view: PlayerView, contact: Contact): Choice;
}

/**
 * Plays `orders` then `rounds - 1` rounds of `policy` on a state rebuilt from `view`, enemies staying put
 * (their contact choices are the defaults). Returns the resulting view.
 */
export function simulate(view: PlayerView, data: GameData, orders: Order[], rounds: number, policy: SimPolicy): PlayerView {
  const side = view.side;
  const enemy = other(side);
  let state = stateFromView(view, data);
  let mine = orders;
  for (let i = 0; i < rounds && !state.over; i++) {
    const current = viewFor(state, data, side);
    if (i > 0) mine = policy.orders(current);
    const theirs = defaultOrders(state, data, enemy);
    const all: Orders = side === 'blue' ? { blue: mine, red: theirs } : { blue: theirs, red: mine };
    const choices: ContactChoices = {};
    for (const c of detectContacts(state, data, all)) choices[c.id] = { [side]: policy.choice(current, c) };
    state = resolveRound(state, data, all, choices).state;
  }
  return viewFor(state, data, side);
}
