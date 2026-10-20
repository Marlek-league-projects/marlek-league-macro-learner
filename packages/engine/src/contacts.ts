import type { GameData, Side } from '@lml/data/contracts';
import type { Choice, Contact, ContactChoices, ContactKind, GameState, Orders } from './contracts';

const SIDES: Side[] = ['blue', 'red'];
const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');

/** Champion to position after orders. Recall stays put, spawn enters at its target, dead champions are absent. */
export function arrivalPositions(state: GameState, orders: Orders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of state.champions) {
    if (c.status === 'dead') continue;
    const o = orders[c.side].find((x) => x.champion === c.id);
    out[c.id] = o && o.kind !== 'recall' ? o.to : c.position;
  }
  return out;
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
  if (kind === 'trade') {
    for (const s of SIDES) {
      options[s] = ['farm', 'trade', 'fight', 'flee'];
      defaults[s] = 'farm';
    }
  } else if (kind === 'invade' && invader) {
    options[invader] = ['fight'];
    defaults[invader] = 'fight';
  }
  return { id: position, position, kind, blue, red, options, defaults, invader };
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
    let kind: ContactKind = 'skirmish';
    let invader: Side | null = null;
    if (p.kind === 'tower' || p.kind === 'laneMid') kind = blue.length === red.length ? 'trade' : 'gank';
    else if (p.kind === 'pit' || p.kind === 'scuttle') kind = 'objective';
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
