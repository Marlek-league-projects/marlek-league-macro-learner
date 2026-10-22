import { mirrorId } from '@lml/data';
import type { GameData, Lane, Side } from '@lml/data/contracts';
import type { ChampionState, Choice, Contact, ContactChoices, ContactKind, GameState, Orders, Stance } from './contracts';
import { budgetFrom, canAct, HOME_LANE, moveStart, reachableFrom } from './movement';
import { roundWindow } from './time';

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

/** Push shoves the wave (see `updateLanes`) but plays a lane contact exactly like Farm: no trade, never all-in. */
const STANCE_CHOICE: Record<Stance, Choice> = { push: 'farm', farm: 'farm', trade: 'trade', allin: 'fight' };

/** A laner on this stance never dies in an even lane contact (Farm and Push play safe). */
export function playsSafe(stance: Stance): boolean {
  return STANCE_CHOICE[stance] === 'farm';
}
/** The ganked side of a gank contact: the smaller one, caught by a champion arriving from elsewhere. Null otherwise. */
export function gankedSide(contact: Contact): Side | null {
  if (contact.kind !== 'gank') return null;
  return contact.blue.length < contact.red.length ? 'blue' : 'red';
}

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

/** Zone of a position: its lane, its river (Scuttle + pit), or the camp itself. Null for a base (never a contact). */
export function zoneOf(data: GameData, position: string): string | null {
  const p = data.graph.positions[position];
  if (!p || p.kind === 'base') return null;
  if (p.lane) return `lane-${p.lane}`;
  if (position === 'scuttle-top' || position === 'baron-pit') return 'river-top';
  if (position === 'scuttle-bot' || position === 'dragon-pit') return 'river-bot';
  return position;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Where a contact's fight resolves: the position of the smaller side (the one with most of its champions), or on
 * even numbers the zone position with the most champions. Remaining ties are side-neutral: in a lane, the position
 * closest to the lane middle (the lane middle itself when two are as close); elsewhere the lowest mirror-normalized
 * id (an id or its mirror, whichever sorts first).
 */
export function fightPosition(data: GameData, arrival: Record<string, string>, blue: string[], red: string[]): string {
  const ids = blue.length < red.length ? blue : red.length < blue.length ? red : [...blue, ...red];
  const count = new Map<string, number>();
  for (const id of ids) count.set(arrival[id]!, (count.get(arrival[id]!) ?? 0) + 1);
  const most = Math.max(...count.values());
  const tied = [...count].filter(([, n]) => n === most).map(([p]) => p);
  const lane = data.graph.positions[tied[0]!]!.lane;
  if (lane) {
    const mid = `${lane}-lane`;
    const toMid = (p: string): number => data.graph.distance(p, mid);
    const nearest = Math.min(...tied.map(toMid));
    const best = tied.filter((p) => toMid(p) === nearest);
    return best.length === 1 ? best[0]! : mid;
  }
  const key = (p: string): string => (p < mirrorId(p) ? p : mirrorId(p));
  return tied.sort((a, b) => byId(key(a), key(b)))[0]!;
}

type Zone = { id: string; position: string; positions: string[]; blue: string[]; red: string[] };

/** A prompted contact: fight or flee (plus `extra[side]`); the smaller side flees by default, otherwise it fights. */
function build(kind: ContactKind, zone: Zone, invader: Side | null, extra: Partial<Record<Side, Choice>> = {}): Omit<Contact, 'hp' | 'nearby'> {
  const { blue, red } = zone;
  const n: Record<Side, number> = { blue: blue.length, red: red.length };
  const options = {} as Record<Side, Choice[]>;
  const defaults = {} as Record<Side, Choice>;
  for (const s of SIDES) {
    options[s] = ['fight', 'flee', ...(extra[s] ? [extra[s]] : [])];
    defaults[s] = n[s] < n[other(s)] ? 'flee' : 'fight';
  }
  if (kind === 'invade' && invader) {
    options[invader] = ['fight'];
    defaults[invader] = 'fight';
  }
  return { ...zone, kind, options, defaults, invader, auto: false };
}

/** A lane contact resolved without a prompt: each side's only option is `choice[side]`. */
function buildAuto(kind: ContactKind, zone: Zone, choice: Record<Side, Choice>): Omit<Contact, 'hp' | 'nearby'> {
  const options = { blue: [choice.blue], red: [choice.red] };
  return { ...zone, kind, options, defaults: { ...choice }, invader: null, auto: true };
}

/**
 * A prompted lane contact's kind: even, a `skirmish`; uneven, a `gank` when the bigger side includes a champion who
 * arrived from outside the lane this round (or spawned, or `joined` it from 1 step away), else `pressure`. A laner
 * coming back to (or joining a fight in) its own lane is not a ganker.
 */
function promptedLaneKind(state: GameState, data: GameData, lane: Lane, sides: Record<Side, string[]>, joined: Set<string>): ContactKind {
  const { blue, red } = sides;
  if (blue.length === red.length) return 'skirmish';
  const bigger: Side = blue.length > red.length ? 'blue' : 'red';
  const arrived = (id: string): boolean => {
    const c = state.champions.find((x) => x.id === id)!;
    if (c.role !== 'jungle' && HOME_LANE[c.role] === lane) return false;
    return joined.has(id) || c.status !== 'alive' || data.graph.positions[c.position]?.lane !== lane;
  };
  return sides[bigger].some(arrived) ? 'gank' : 'pressure';
}

/**
 * Contact in a lane zone. Standard laning (even numbers, all home laners of that lane): a `trade` resolved from both
 * stances. Otherwise prompted: uneven, a `gank` when the bigger side includes a champion who arrived from outside the
 * lane this round (or spawned), else `pressure`; even, a `skirmish`. A laner coming back to its own lane is not a
 * ganker. A smaller side whose champions all arrive on their own standing tower may also stay and `farm`.
 */
function laneContact(state: GameState, data: GameData, orders: Orders, arrival: Record<string, string>, zone: Zone): Omit<Contact, 'hp' | 'nearby'> {
  const { blue, red } = zone;
  const champ = (id: string): ChampionState => state.champions.find((c) => c.id === id)!;
  const lane = data.graph.positions[zone.position]!.lane!;
  const homeLaner = (c: ChampionState): boolean => c.role !== 'jungle' && HOME_LANE[c.role] === lane;
  if (blue.length === red.length && [...blue, ...red].every((id) => homeLaner(champ(id)))) {
    return buildAuto('trade', zone, { blue: stanceChoice(state, orders, blue), red: stanceChoice(state, orders, red) });
  }
  const kind = promptedLaneKind(state, data, lane, zone, new Set());
  if (kind === 'skirmish') return build('skirmish', zone, null);
  const smaller: Side = blue.length < red.length ? 'blue' : 'red';
  const onOwnTower = zone[smaller].every((id) => {
    const p = data.graph.positions[arrival[id]!]!;
    return p.kind === 'tower' && p.side === smaller && (state.towers[arrival[id]!] ?? 0) > 0;
  });
  return build(kind, zone, null, onOwnTower ? { [smaller]: 'farm' } : {});
}

/**
 * Whether `side` knows of something to take in the river: its pit objective up (or spawning by this round's end; pits
 * are public), or its Scuttle up by this round's end as `side` last saw it. Else no objective to keep on.
 */
function riverHasObjective(state: GameState, data: GameData, zone: string, side: Side): boolean {
  const end = roundWindow(data.rules, state.round).end;
  const [pitId, scuttleId] = zone === 'river-top' ? (['baron-pit', 'scuttle-top'] as const) : (['dragon-pit', 'scuttle-bot'] as const);
  const pit = state.pits[pitId];
  return pit.objective !== null || (pit.nextSpawn !== null && pit.nextSpawn <= end) || state.scuttlesSeen[side][scuttleId] <= end;
}

/**
 * Enemies ending the round in the same zone (a lane, a river, a camp; never a base). Crossing on an edge is not a
 * contact. Contacts are sorted by zone id.
 */
export function detectContacts(state: GameState, data: GameData, orders: Orders): Contact[] {
  const arrival = arrivalPositions(state, orders);
  const zones = new Map<string, Record<Side, string[]>>();
  for (const c of state.champions) {
    const pos = arrival[c.id];
    if (pos === undefined) continue;
    const zone = zoneOf(data, pos);
    if (zone === null) continue;
    const entry = zones.get(zone) ?? { blue: [], red: [] };
    entry[c.side].push(c.id);
    zones.set(zone, entry);
  }
  /** A step left on arrival (a recall never: the recall is its action), as in `resolveRound`; a spawn walks from its base. */
  const acts = (id: string): boolean => {
    const c = state.champions.find((x) => x.id === id)!;
    const kind = orders[c.side].find((o) => o.champion === id)?.kind;
    if (kind === 'recall') return false;
    const from = moveStart(c);
    const budget = budgetFrom(data.rules, state.round, from, c.side);
    return canAct(reachableFrom(data, from, budget, c.side)[arrival[id]!] ?? budget, budget);
  };
  const out: Omit<Contact, 'hp' | 'nearby'>[] = [];
  for (const [id, { blue, red }] of zones) {
    if (blue.length === 0 || red.length === 0) continue;
    blue.sort();
    red.sort();
    const positions = [...new Set([...blue, ...red].map((c) => arrival[c]!))].sort();
    const zone: Zone = { id, position: fightPosition(data, arrival, blue, red), positions, blue, red };
    const p = data.graph.positions[zone.position]!;
    if (p.lane) {
      out.push(laneContact(state, data, orders, arrival, zone));
    } else if (id.startsWith('river-')) {
      const extra: Partial<Record<Side, Choice>> = {};
      for (const s of SIDES) if (riverHasObjective(state, data, id, s) && zone[s].some(acts)) extra[s] = 'objective';
      out.push(build('objective', zone, null, extra));
    } else if (p.kind === 'camp' && p.side) {
      out.push(build('invade', zone, other(p.side)));
    } else {
      out.push(build('skirmish', zone, null));
    }
  }
  const hp = (c: Omit<Contact, 'hp' | 'nearby'>): Record<string, number> =>
    Object.fromEntries([...c.blue, ...c.red].map((id) => [id, state.champions.find((x) => x.id === id)!.hp]));
  const inContact = new Set(out.flatMap((c) => [...c.blue, ...c.red]));
  /** Alive, in no contact, not recalling (a spawn is not alive yet), arrived 1 step from one of `c.positions`, not from another lane. */
  const nearby = (c: Omit<Contact, 'hp' | 'nearby'>): Record<Side, string[]> => {
    const near: Record<Side, string[]> = { blue: [], red: [] };
    if (c.auto) return near;
    const contactLane = c.id.startsWith('lane-') ? data.graph.positions[c.position]?.lane : undefined;
    for (const champ of state.champions) {
      if (champ.status !== 'alive' || inContact.has(champ.id)) continue;
      if (orders[champ.side].find((o) => o.champion === champ.id)?.kind === 'recall') continue;
      // A lane contact cannot be joined from another lane (from the jungle or the river it can).
      const from = data.graph.positions[arrival[champ.id]!]?.lane;
      if (contactLane !== undefined && from !== undefined && from !== contactLane) continue;
      const adj = data.graph.adj[arrival[champ.id]!] ?? [];
      if (c.positions.some((p) => adj.includes(p))) near[champ.side].push(champ.id);
    }
    near.blue.sort();
    near.red.sort();
    return near;
  };
  return out.map((c) => ({ ...c, hp: hp(c), nearby: nearby(c) })).sort((a, b) => byId(a.id, b.id));
}

/**
 * Each side's joiners of `contact` as given in `choices` (validated against `contact.nearby`; throws otherwise),
 * minus the champions in `taken` (already joining an earlier contact: a champion joins at most one).
 */
export function resolveJoins(contact: Contact, choices: ContactChoices, taken: ReadonlySet<string> = new Set()): Record<Side, string[]> {
  const given = choices[contact.id]?.joins ?? {};
  const out: Record<Side, string[]> = { blue: [], red: [] };
  for (const s of SIDES) {
    for (const id of given[s] ?? []) {
      if (!contact.nearby[s].includes(id)) throw new Error(`${s}: ${id} cannot join ${contact.id}`);
      if (!taken.has(id) && !out[s].includes(id)) out[s].push(id);
    }
    out[s].sort();
  }
  return out;
}

/**
 * `contact` with `joins` added to its sides (sorted) and, for a lane contact, its kind re-evaluated on the new
 * numbers (`promptedLaneKind`: a joiner from outside the lane making its side bigger turns it into a gank, evening
 * the numbers into a skirmish). Options, defaults, position and HP stay as prompted; a river or camp keeps its kind.
 */
export function withJoiners(state: GameState, data: GameData, contact: Contact, joins: Partial<Record<Side, string[]>>): Contact {
  const joined = new Set([...(joins.blue ?? []), ...(joins.red ?? [])]);
  if (joined.size === 0) return contact;
  const blue = [...contact.blue, ...(joins.blue ?? [])].sort();
  const red = [...contact.red, ...(joins.red ?? [])].sort();
  const lane = data.graph.positions[contact.position]!.lane;
  const kind = lane && !contact.auto ? promptedLaneKind(state, data, lane, { blue, red }, joined) : contact.kind;
  return { ...contact, blue, red, kind };
}

/** Fills missing choices with defaults. Throws if a given choice is not among the side's options. */
export function resolveChoice(contact: Contact, choices: ContactChoices): Record<Side, Choice> {
  const given = choices[contact.id] ?? {};
  const out = {} as Record<Side, Choice>;
  for (const s of SIDES) {
    const c = given[s] ?? contact.defaults[s];
    if (!contact.options[s].includes(c)) throw new Error(`${s}: ${c} not allowed at ${contact.id}`);
    out[s] = c;
  }
  return out;
}
