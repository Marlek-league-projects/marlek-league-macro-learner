import type { GameData, Side } from '@lml/data/contracts';
import type { ChampionState, Choice, Contact, ContactChoices, ContactKind, GameState, Orders, Stance } from './contracts';

const SIDES: Side[] = ['blue', 'red'];
const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');

/**
 * Champion to position after orders. Recall stays put or takes its 1 step first, spawn enters at its target,
 * dead champions are absent.
 */
export function arrivalPositions(state: GameState, orders: Orders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of state.champions) {
    if (c.status === 'dead') continue;
    const o = orders[c.side].find((x) => x.champion === c.id);
    out[c.id] = o?.to ?? c.position;
  }
  return out;
}

const STANCE_CHOICE: Record<Stance, Choice> = { farm: 'farm', trade: 'trade', allin: 'fight' };
const AGGRESSION: Choice[] = ['farm', 'trade', 'fight'];

/** A side's lane choice from its champions' stances (an order's `stance` first): the most aggressive one. */
function stanceChoice(state: GameState, orders: Orders, ids: string[]): Choice {
  let best = 0;
  for (const id of ids) {
    const c = state.champions.find((x) => x.id === id)!;
    const stance = orders[c.side].find((o) => o.champion === id)?.stance ?? c.stance;
    best = Math.max(best, AGGRESSION.indexOf(STANCE_CHOICE[stance]));
  }
  return AGGRESSION[best]!;
}

function build(
  kind: ContactKind,
  position: string,
  blue: string[],
  red: string[],
  invader: Side | null,
): Contact {
  const n: Record<Side, number> = { blue: blue.length, red: red.length };
  const options = { blue: ['fight', 'flee'], red: ['fight', 'flee'] } as Record<Side, Choice[]>;
  const defaults = {} as Record<Side, Choice>;
  for (const s of SIDES) defaults[s] = n[s] < n[other(s)] ? 'flee' : 'fight';
  if (kind === 'invade' && invader) {
    options[invader] = ['fight'];
    defaults[invader] = 'fight';
  }
  return { id: position, position, kind, blue, red, options, defaults, invader, auto: false };
}

/** A lane contact resolved without a prompt: each side's only option is `choice[side]`. */
function buildAuto(kind: ContactKind, position: string, blue: string[], red: string[], choice: Record<Side, Choice>): Contact {
  const options = { blue: [choice.blue], red: [choice.red] };
  return { id: position, position, kind, blue, red, options, defaults: { ...choice }, invader: null, auto: true };
}

/**
 * Contact on a lane position. Even numbers: a `trade` resolved from both stances. Uneven: a `gank` when the bigger
 * side includes a champion who arrived from outside the lane this round (or spawned), otherwise `pressure`, where
 * the smaller side can only farm and the bigger side's stance applies.
 */
function laneContact(state: GameState, data: GameData, orders: Orders, position: string, blue: string[], red: string[]): Contact {
  const choice = { blue: stanceChoice(state, orders, blue), red: stanceChoice(state, orders, red) };
  if (blue.length === red.length) return buildAuto('trade', position, blue, red, choice);
  const bigger: Side = blue.length > red.length ? 'blue' : 'red';
  const lane = data.graph.positions[position]!.lane;
  const arrived = (c: ChampionState): boolean => c.status !== 'alive' || data.graph.positions[c.position]?.lane !== lane;
  const ids = bigger === 'blue' ? blue : red;
  if (ids.some((id) => arrived(state.champions.find((c) => c.id === id)!))) {
    return build('gank', position, blue, red, null);
  }
  choice[other(bigger)] = 'farm';
  return buildAuto('pressure', position, blue, red, choice);
}

/** Enemies ending the round on the same position. Crossing on an edge is not a contact. */
export function detectContacts(state: GameState, data: GameData, orders: Orders): Contact[] {
  const arrival = arrivalPositions(state, orders);
  const byPos = new Map<string, Record<Side, string[]>>();
  for (const c of state.champions) {
    const pos = arrival[c.id];
    if (pos === undefined) continue;
    const entry = byPos.get(pos) ?? { blue: [], red: [] };
    entry[c.side].push(c.id);
    byPos.set(pos, entry);
  }
  const out: Contact[] = [];
  for (const [position, { blue, red }] of byPos) {
    if (blue.length === 0 || red.length === 0) continue;
    const p = data.graph.positions[position];
    if (!p || p.kind === 'base') continue;
    blue.sort();
    red.sort();
    if (p.kind === 'tower' || p.kind === 'laneMid') {
      out.push(laneContact(state, data, orders, position, blue, red));
      continue;
    }
    let kind: ContactKind = 'skirmish';
    let invader: Side | null = null;
    if (p.kind === 'pit' || p.kind === 'scuttle') kind = 'objective';
    else if (p.kind === 'camp' && p.side) {
      kind = 'invade';
      invader = other(p.side);
    }
    out.push(build(kind, position, blue, red, invader));
  }
  return out.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

/** Fills missing choices with defaults. Throws if a given choice is not among the side's options. */
export function resolveChoice(contact: Contact, choices: ContactChoices): Record<Side, Choice> {
  const given = choices[contact.id] ?? {};
  const out = {} as Record<Side, Choice>;
  for (const s of SIDES) {
    const c = given[s] ?? contact.defaults[s];
    if (!contact.options[s].includes(c)) throw new Error(`${s}: ${c} not allowed at ${contact.position}`);
    out[s] = c;
  }
  return out;
}
