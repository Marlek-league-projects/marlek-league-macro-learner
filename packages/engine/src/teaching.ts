import type { GameData, Lane, ObjectiveId, Role, Side } from '@lml/data/contracts';
import type { Explanation, GameEvent, GameState } from './contracts';
import { roundWindow } from './time';
import { eventsFor } from './vision';

type Placeholder = 'champion' | 'position' | 'n' | 'm' | 'objective';
type Bindings = Partial<Record<Placeholder, string>>;

interface Context {
  before: GameState;
  after: GameState;
  /** Events `side` may know about (fog of war applied). */
  events: GameEvent[];
  data: GameData;
  side: Side;
}
type Predicate = (ctx: Context) => Bindings[];

const ROLE_LANE: Partial<Record<Role, Lane>> = { top: 'top', mid: 'mid', adc: 'bot', support: 'bot' };
/** Wave position that sits at `side`'s own tower. */
const ownTower = (side: Side): -1 | 1 => (side === 'blue' ? -1 : 1);
const other = (side: Side): Side => (side === 'blue' ? 'red' : 'blue');

const champ = (ctx: Context, id: string): GameState['champions'][number] | undefined =>
  ctx.after.champions.find((c) => c.id === id);
const name = (ctx: Context, id: string): string => ctx.data.champions[id]?.name ?? id;
const label = (ctx: Context, position: string): string => ctx.data.graph.positions[position]?.label ?? position;
const laneOf = (ctx: Context, id: string): Lane | undefined => {
  const c = champ(ctx, id);
  return c ? ROLE_LANE[c.role] : undefined;
};

const ownDeaths = (ctx: Context): Array<Extract<GameEvent, { type: 'death' }>> =>
  ctx.events.filter((e): e is Extract<GameEvent, { type: 'death' }> =>
    e.type === 'death' && champ(ctx, e.champion)?.side === ctx.side);

type Moved = Extract<GameEvent, { type: 'moved' }>;

/** Own laners' moves out of their lane while its wave was not pushed (not at the opponent's tower). */
const leftUnpushedLane = (ctx: Context): Moved[] =>
  ctx.events.filter((e): e is Moved => {
    if (e.type !== 'moved' || champ(ctx, e.champion)?.side !== ctx.side) return false;
    const lane = laneOf(ctx, e.champion);
    if (!lane) return false;
    const inLane = new Set(ctx.data.graph.lanePositions(lane));
    return inLane.has(e.from) && !inLane.has(e.to) && ctx.before.waves[lane] * ownTower(ctx.side) >= 0;
  });

/**
 * Objective the move went to play: one up or taken this round on its destination, a pit or a scuttle, or on a
 * pit next to that scuttle (the step toward the pit). Scuttles are judged from what `side` had seen of them.
 */
function objectivePlayed(ctx: Context, e: Moved): ObjectiveId | null {
  const kind = ctx.data.graph.positions[e.to]?.kind;
  if (kind !== 'pit' && kind !== 'scuttle') return null;
  const end = roundWindow(ctx.data.rules, ctx.before.round).end;
  const isPit = (p: string): boolean => ctx.data.graph.positions[p]?.kind === 'pit';
  const nextPits = kind === 'scuttle' ? (ctx.data.graph.adj[e.to] ?? []).filter(isPit) : [];
  for (const pos of [e.to, ...nextPits]) {
    const taken = ctx.events.find((x) => x.type === 'objectiveTaken' && x.position === pos);
    if (taken?.type === 'objectiveTaken') return taken.objective;
    if (!isPit(pos)) {
      const seen = ctx.before.scuttlesSeen[ctx.side][pos as keyof GameState['scuttles']];
      if (seen <= end) return 'scuttle';
    } else {
      const up = ctx.after.pits[pos as keyof GameState['pits']]?.objective;
      if (up) return up;
    }
  }
  return null;
}

const PREDICATES: Record<string, Predicate> = {
  'recall-wave-under-tower': (ctx) =>
    ctx.events.flatMap((e) => {
      if (e.type !== 'recall' || champ(ctx, e.champion)?.side !== ctx.side) return [];
      const lane = laneOf(ctx, e.champion);
      return lane && ctx.before.waves[lane] === ownTower(ctx.side) ? [{ champion: name(ctx, e.champion) }] : [];
    }),

  'left-lane-without-priority': (ctx) =>
    leftUnpushedLane(ctx).flatMap((e) => (objectivePlayed(ctx, e) ? [] : [{ champion: name(ctx, e.champion) }])),

  'wave-sacrifice-for-objective': (ctx) =>
    leftUnpushedLane(ctx).flatMap((e) => {
      const objective = objectivePlayed(ctx, e);
      return objective ? [{ champion: name(ctx, e.champion), objective: ctx.data.objectiveNames[objective] }] : [];
    }),

  'outnumbered-death': (ctx) =>
    ownDeaths(ctx).flatMap((d) => {
      const fight = ctx.events.find((e) => e.type === 'fight' && e.position === d.position);
      if (fight?.type !== 'fight') return [];
      const mine = fight[ctx.side].length;
      const theirs = fight[other(ctx.side)].length;
      if (mine >= theirs) return [];
      return [{ champion: name(ctx, d.champion), position: label(ctx, d.position), n: String(theirs), m: String(mine) }];
    }),

  'enemy-rotated-with-priority': (ctx) =>
    ctx.events.flatMap((e) => {
      if (e.type !== 'moved' || champ(ctx, e.champion)?.side !== other(ctx.side)) return [];
      const lane = laneOf(ctx, e.champion);
      const kind = ctx.data.graph.positions[e.to]?.kind;
      if (!lane || (kind !== 'scuttle' && kind !== 'pit')) return [];
      return ctx.before.waves[lane] === ownTower(ctx.side) ? [{ position: label(ctx, e.to) }] : [];
    }),

  'objective-uncontested': (ctx) =>
    ctx.events.flatMap((e) => {
      if (e.type !== 'objectiveTaken' || e.side !== other(ctx.side)) return [];
      const fought = ctx.events.some((f) => f.type === 'fight' && f.position === e.position);
      return fought ? [] : [{ objective: ctx.data.objectiveNames[e.objective] }];
    }),

  'late-death': (ctx) =>
    roundWindow(ctx.data.rules, ctx.before.round).stage === 4
      ? ownDeaths(ctx).map((d) => ({ champion: name(ctx, d.champion) }))
      : [],
};

/** Ids of the teaching rules that have a predicate. */
export const TEACHING_PREDICATE_IDS = Object.keys(PREDICATES);

const fill = (text: string, b: Bindings): string =>
  text.replace(/\{(\w+)\}/g, (whole, key: string) => b[key as Placeholder] ?? whole);

/** Tempo lessons for `side` about the round `before` → `after`, built only from events `side` could see. */
export function explainRound(
  before: GameState,
  after: GameState,
  events: GameEvent[],
  data: GameData,
  side: Side,
): Explanation[] {
  const ctx: Context = { before, after, events: eventsFor(events, after, data, side), data, side };
  return data.teaching.flatMap((rule) =>
    (PREDICATES[rule.id]?.(ctx) ?? []).map((b) => ({
      ruleId: rule.id,
      roundsLost: rule.roundsLost,
      text: fill(rule.text, b),
    })),
  );
}
