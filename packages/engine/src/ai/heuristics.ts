import { MISTAKE_IDS } from '@lml/data';
import type { AiProfile, GameData, Lane, MistakeId, ObjectiveId, Role, Side } from '@lml/data/contracts';
import type { ChampionState, Choice, Contact, EnemyInfo, Order, PlayerView, Rng, Stance } from '../contracts';
import { resolveFight } from '../fight';
import { movesFor, reachableFrom, spawnPointsFor } from '../movement';
import type { PitId } from '../objectives';
import { roundWindow } from '../time';
import { other, ourWave, PITS, pitTiming } from './evaluate';
import { stateFromView } from './simulate';

export type Mistakes = Map<string, Set<MistakeId>>;

export interface Candidate {
  order: Order;
  score: number;
  /** Lane a jungler gank targets, for the laners to join. */
  gank?: Lane;
  /**
   * A laner's paying rotation: kept over the look-ahead, which cannot value the numbers it brings (simulated
   * enemies stand still).
   */
  committed?: boolean;
}

type Extra = Pick<Candidate, 'gank' | 'committed'>;

interface Ctx {
  view: PlayerView;
  data: GameData;
  side: Side;
  enemy: Side;
  /** End time (s) of the view's round. */
  end: number;
  jungler: EnemyInfo | undefined;
  gank: { lane: Lane; target: string } | null;
  /** The profile's `waveSacrifice`: laners may rotate when `rotationPays`. */
  waveSacrifice: boolean;
}

const LANES: Lane[] = ['top', 'mid', 'bot'];
const SCUTTLES = ['scuttle-top', 'scuttle-bot'] as const;
const HOME_LANE: Record<Exclude<Role, 'jungle'>, Lane> = { top: 'top', mid: 'mid', adc: 'bot', support: 'bot' };
const PIT_LANE: Record<PitId, Lane> = { 'dragon-pit': 'bot', 'baron-pit': 'top' };
const PIT_ROLES: Record<ObjectiveId, Role[]> = {
  dragon: ['jungle', 'adc', 'support'],
  voidgrubs: ['jungle', 'top'],
  herald: ['jungle', 'top'],
  baron: ['jungle', 'top', 'mid'],
  scuttle: ['jungle'],
};
// ---------- map helpers ----------

const distCache = new WeakMap<GameData, Map<string, Record<string, number>>>();

/** Graph distance, cached per data set (the AI asks for thousands per game; an uncached BFS triples the fuzz time). */
function dist(data: GameData, a: string, b: string): number {
  let cache = distCache.get(data);
  if (!cache) distCache.set(data, (cache = new Map()));
  let from = cache.get(a);
  if (!from) {
    from = { [a]: 0 };
    const queue = [a];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i]!;
      for (const n of data.graph.adj[cur] ?? []) {
        if (from[n] === undefined) {
          from[n] = from[cur]! + 1;
          queue.push(n);
        }
      }
    }
    cache.set(a, from);
  }
  return from[b] ?? Infinity;
}

const laneOf = (data: GameData, pos: string): Lane | undefined => data.graph.positions[pos]?.lane;

function laneMid(data: GameData, lane: Lane): string {
  return Object.values(data.graph.positions).find((p) => p.kind === 'laneMid' && p.lane === lane)!.id;
}

/** Map half by the closest pit; null when equally far. */
function half(data: GameData, pos: string): PitId | null {
  const top = dist(data, pos, 'baron-pit');
  const bot = dist(data, pos, 'dragon-pit');
  return top < bot ? 'baron-pit' : bot < top ? 'dragon-pit' : null;
}

function front(ctx: Ctx, side: Side, lane: Lane): string | null {
  return ctx.data.graph.towers(side, lane).find((t) => (ctx.view.towers[t] ?? 0) > 0) ?? null;
}

function reach(ctx: Ctx, c: ChampionState): Record<string, number> {
  return reachableFrom(ctx.data, c.position, movesFor(c, ctx.data.rules), c.side, c.role);
}

/** Reachable position closest to `target`, fewest moves then id as tie-breaks. */
function step(ctx: Ctx, c: ChampionState, target: string): string {
  const r = reach(ctx, c);
  return Object.keys(r).sort(
    (a, b) => dist(ctx.data, a, target) - dist(ctx.data, b, target) || r[a]! - r[b]! || a.localeCompare(b),
  )[0]!;
}

const moveTo = (c: ChampionState, to: string): Order => ({ kind: 'move', champion: c.id, to });

/** Seen recently enough (`aiTuning.knownRounds`) that its position is current. */
const known = (ctx: Ctx, e: EnemyInfo | undefined): e is EnemyInfo & { position: string } =>
  !!e && e.position !== null && e.lastSeenRound !== null && ctx.view.round - e.lastSeenRound <= ctx.data.aiTuning.knownRounds;

// ---------- context and mistakes ----------

export function makeContext(view: PlayerView, data: GameData, waveSacrifice: boolean): Ctx {
  return {
    view,
    data,
    side: view.side,
    enemy: other(view.side),
    end: roundWindow(data.rules, view.round).end,
    jungler: view.enemies.find((e) => e.role === 'jungle'),
    gank: null,
    waveSacrifice,
  };
}

/** One roll per ally and mistake, in `MISTAKE_IDS` order. */
export function rollMistakes(view: PlayerView, profile: AiProfile, rng: Rng): Mistakes {
  const out: Mistakes = new Map();
  for (const c of view.allies) {
    const set = new Set<MistakeId>();
    for (const id of MISTAKE_IDS) if (rng.next() < profile.mistakes[id]) set.add(id);
    out.set(c.id, set);
  }
  return out;
}

// ---------- rules ----------

function spawnOrder(ctx: Ctx, c: ChampionState): Order {
  const points = spawnPointsFor(ctx.view, ctx.data, c.id);
  let to: string;
  if (c.role === 'jungle') {
    const alive = points.filter((p) => (ctx.view.camps[p] ?? Infinity) <= ctx.end);
    to = alive.find((p) => /^(blue|red)buff-/.test(p)) ?? alive[0] ?? points[0]!;
  } else {
    const mid = laneMid(ctx.data, HOME_LANE[c.role]);
    to = [...points].sort((a, b) => dist(ctx.data, a, mid) - dist(ctx.data, b, mid))[0]!;
  }
  return { kind: 'spawn', champion: c.id, to };
}

/** Back to lane for a laner, to the nearest own camp for the jungler. */
function home(ctx: Ctx, c: ChampionState): Order {
  if (c.role !== 'jungle') {
    const lane = HOME_LANE[c.role];
    return moveTo(c, step(ctx, c, front(ctx, ctx.side, lane) ?? laneMid(ctx.data, lane)));
  }
  const camps = Object.keys(ctx.view.camps).sort((a, b) => dist(ctx.data, c.position, a) - dist(ctx.data, c.position, b));
  return moveTo(c, step(ctx, c, camps[0] ?? c.position));
}

/** `pointlessPlay`: a random invade (jungler) or roam. */
function pointless(ctx: Ctx, c: ChampionState, rng: Rng): Order {
  const r = Object.keys(reach(ctx, c)).sort();
  const invades = r.filter((p) => ctx.data.graph.positions[p]?.kind === 'camp' && ctx.data.graph.positions[p]!.side === ctx.enemy);
  const roams = r.filter((p) => p !== c.position);
  const pool = c.role === 'jungle' && invades.length > 0 ? invades : roams.length > 0 ? roams : r;
  return moveTo(c, rng.pick(pool));
}

function herald(ctx: Ctx, c: ChampionState): Order {
  const r = reach(ctx, c);
  const targets = LANES.map((l) => front(ctx, ctx.enemy, l)).filter((t): t is string => t !== null);
  const inRange = targets.find((t) => r[t] !== undefined);
  if (inRange) return { kind: 'move', champion: c.id, to: inRange, launchHerald: true };
  const nearest = [...targets].sort((a, b) => dist(ctx.data, c.position, a) - dist(ctx.data, c.position, b))[0];
  return moveTo(c, nearest ? step(ctx, c, nearest) : c.position);
}

/**
 * A laner leaving its lane for `pit` pays (only for profiles with `waveSacrifice`): the objective is worth more than `aiTuning.waveSacrificeCost` (the wave
 * it gives up) and the champion's arrival gives its side the numbers there. Allies count, and known enemies (seen
 * within `aiTuning.knownRounds`) count against, when within a jungler's move of the pit; the laner must be too.
 */
function rotationPays(ctx: Ctx, c: ChampionState, pit: PitId, objective: ObjectiveId): boolean {
  const { data } = ctx;
  const rule = data.rules.objectives[objective];
  if (!ctx.waveSacrifice || c.role === 'jungle' || rule.value <= data.aiTuning.waveSacrificeCost) return false;
  const near = (pos: string): boolean => dist(data, pos, pit) <= data.rules.moves.jungler;
  if (!near(c.position)) return false;
  const ours = ctx.view.allies.filter((a) => a.status === 'alive' && near(a.position)).length;
  const theirs = ctx.view.enemies.filter((e) => known(ctx, e) && near(e.position)).length;
  return ours >= rule.minChampions && ours > theirs;
}

/**
 * Objective setup: to the pit one round before spawn (or while up), for the objective's roles with lane priority
 * (`rotateWithoutPriority` drops that check), or for any laner whose rotation pays, wave sacrificed if needed.
 */
function objectives(ctx: Ctx, c: ChampionState, m: Set<MistakeId>, add: (s: number, o: Order, x?: Extra) => void): void {
  for (const pit of PITS) {
    const t = pitTiming(ctx.view, ctx.data, pit);
    if (!t.objective || (!t.live && !t.soon)) continue;
    if (t.soon && m.has('objectiveTiming')) continue;
    const roles = PIT_ROLES[t.objective];
    const able = ctx.view.allies.filter((a) => a.status !== 'dead' && roles.includes(a.role)).length;
    const lane = c.role === 'jungle' ? PIT_LANE[pit] : HOME_LANE[c.role];
    const assigned =
      roles.includes(c.role) &&
      able >= ctx.data.rules.objectives[t.objective].minChampions &&
      (ourWave(ctx.view, lane) >= 0 || m.has('rotateWithoutPriority'));
    const pays = !assigned && rotationPays(ctx, c, pit, t.objective);
    if (!assigned && !pays) continue;
    add(ctx.data.aiTuning.priorities.objective, moveTo(c, step(ctx, c, pit)), pays ? { committed: true } : undefined);
  }
}

/** Recall on a shoved or even wave (no objective coming for the jungler); `badRecall` inverts it. */
function recall(ctx: Ctx, c: ChampionState, m: Set<MistakeId>, add: (s: number, o: Order) => void): void {
  if (c.gold < ctx.data.aiTuning.recallGold) return;
  const good =
    c.role === 'jungle'
      ? !PITS.some((p) => {
          const t = pitTiming(ctx.view, ctx.data, p);
          return t.live || t.soon;
        })
      : ourWave(ctx.view, HOME_LANE[c.role]) >= 0;
  if (good === m.has('badRecall')) return;
  const order: Order = { kind: 'recall', champion: c.id };
  // A laner off its tower steps back under it first, unless a known enemy stands there.
  if (c.role !== 'jungle') {
    const lane = HOME_LANE[c.role];
    const own = front(ctx, ctx.side, lane);
    const guarded = ctx.view.enemies.some((e) => known(ctx, e) && e.position === own);
    const oneStep = own !== null && laneOf(ctx.data, c.position) === lane && dist(ctx.data, c.position, own) === 1;
    if (oneStep && !guarded) order.to = own;
  }
  add(ctx.data.aiTuning.priorities.recall, order);
}

/**
 * Pushing the enemy front tower of `lane` is safe: the enemy jungler is known (seen within
 * `aiTuning.knownRounds`) and out of its range of that tower. `greed` skips the check.
 */
function pushSafe(ctx: Ctx, lane: Lane, m: Set<MistakeId>): boolean {
  if (m.has('greed')) return true;
  const target = front(ctx, ctx.enemy, lane);
  const jg = ctx.jungler;
  return target !== null && known(ctx, jg) && dist(ctx.data, jg.position, target) > ctx.data.rules.moves.jungler;
}

/**
 * After a won fight, take the tower: the enemy laners of the champion's lane were seen in that lane at the
 * start of the last round, within reach of an ally who was in the lane then and still is, and are gone now
 * (dead, or recalled). Only with the wave even or pushed and `pushSafe`. `noConversion` walks back instead.
 * Live objectives are taken by the objective rule, with its role and priority checks.
 */
function conversion(ctx: Ctx, c: ChampionState, m: Set<MistakeId>, add: (s: number, o: Order) => void): void {
  const { view, data } = ctx;
  const lane = laneOf(data, c.position);
  const target = lane ? front(ctx, ctx.enemy, lane) : null;
  if (!lane || !target || (ourWave(view, lane) < 0 && !m.has('greed')) || !pushSafe(ctx, lane, m)) return;
  const watchers = view.allies.filter(
    (a) => a.status === 'alive' && laneOf(data, a.previous) === lane && laneOf(data, a.position) === lane,
  );
  const laners = view.enemies.filter((e) => e.role !== 'jungle' && HOME_LANE[e.role] === lane);
  const fought = laners.every(
    (e) =>
      !e.visible && e.position !== null && e.lastSeenRound === view.round - 2 && laneOf(data, e.position) === lane &&
      watchers.some((a) => dist(data, a.previous, e.position!) <= movesFor(a, data.rules)),
  );
  if (laners.length === 0 || !fought) return;
  add(data.aiTuning.priorities.convert, m.has('noConversion') ? home(ctx, c) : moveTo(c, step(ctx, c, target)));
}

/** Laner: farm in lane, step onto the enemy front tower when the wave is there and the enemy jungler is known far. */
function laning(ctx: Ctx, c: ChampionState, lane: Lane, m: Set<MistakeId>, add: (s: number, o: Order) => void): void {
  const { view, data } = ctx;
  const wave = ourWave(view, lane);
  const enemyFront = front(ctx, ctx.enemy, lane);
  const mid = laneMid(data, lane);
  const own = front(ctx, ctx.side, lane) ?? mid;
  const jg = ctx.jungler;
  const threatened = !m.has('ignoreJungler') && known(ctx, jg) && dist(data, jg.position, mid) <= data.rules.moves.jungler;
  let spot: string;
  if (wave === 1 && enemyFront && pushSafe(ctx, lane, m)) spot = enemyFront;
  else if (wave === 1 && !threatened) spot = mid;
  else spot = own;
  add(ctx.data.aiTuning.priorities.lane, moveTo(c, step(ctx, c, spot)));
  add(ctx.data.aiTuning.priorities.laneAlt, moveTo(c, step(ctx, c, spot === own ? mid : own)));
  if (ctx.gank?.lane === lane && reach(ctx, c)[ctx.gank.target] !== undefined) {
    add(ctx.data.aiTuning.priorities.joinGank, moveTo(c, ctx.gank.target));
  }
}

/** Jungler: gank an overextended laner (away from the enemy jungler), take scuttles, clear or invade camps. */
function jungling(ctx: Ctx, c: ChampionState, m: Set<MistakeId>, add: (s: number, o: Order, x?: Extra) => void): void {
  const { view, data } = ctx;
  const r = reach(ctx, c);
  const jg = ctx.jungler;
  const jgKnown = known(ctx, jg);

  for (const lane of LANES) {
    const mid = laneMid(data, lane);
    if (!m.has('ignoreJungler') && jgKnown) {
      const h = half(data, jg.position);
      if ((h !== null && h === half(data, mid)) || dist(data, jg.position, mid) <= data.rules.moves.jungler) continue;
    }
    const inLane = (pos: string | null): boolean => pos !== null && laneOf(data, pos) === lane;
    const enemies = view.enemies.filter((e) => e.visible && inLane(e.position));
    const allies = view.allies.filter((a) => a.status === 'alive' && inLane(a.position));
    const target = enemies.find((e) => {
      const p = data.graph.positions[e.position!]!;
      const overextended = p.kind === 'laneMid' || (p.kind === 'tower' && p.side === ctx.side);
      return overextended && r[e.position!] !== undefined;
    });
    if (target && allies.length + 1 > enemies.length) add(ctx.data.aiTuning.priorities.gank, moveTo(c, target.position!), { gank: lane });
  }

  for (const id of SCUTTLES) {
    if (view.scuttles[id] <= ctx.end && r[id] !== undefined) add(ctx.data.aiTuning.priorities.scuttle, moveTo(c, id));
  }
  for (const [camp, t] of Object.entries(view.camps)) {
    if (t > ctx.end || r[camp] === undefined) continue;
    const buff = /^(blue|red)buff-/.test(camp);
    add(buff ? ctx.data.aiTuning.priorities.buff : ctx.data.aiTuning.priorities.camp, moveTo(c, camp));
  }
  if (jgKnown) {
    const opposite = half(data, jg.position);
    for (const p of Object.keys(r).sort()) {
      const pos = data.graph.positions[p]!;
      const h = half(data, p);
      if (pos.kind === 'camp' && pos.side === ctx.enemy && opposite !== null && h !== null && h !== opposite) {
        add(ctx.data.aiTuning.priorities.invade, moveTo(c, p));
      }
    }
  }
  const soonest = Object.entries(view.camps).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
  add(ctx.data.aiTuning.priorities.wait, moveTo(c, soonest ? step(ctx, c, soonest[0]) : c.position));
}

/** Scored candidate orders for one champion, best first, without duplicates. */
function candidatesFor(ctx: Ctx, c: ChampionState, m: Set<MistakeId>, rng: Rng): Candidate[] {
  if (c.status === 'respawning') return [{ order: spawnOrder(ctx, c), score: 0 }];
  const out: Candidate[] = [];
  const add = (score: number, order: Order, extra?: Extra): void => {
    out.push({ score, order, ...extra });
  };
  if (m.has('pointlessPlay')) add(ctx.data.aiTuning.priorities.pointless, pointless(ctx, c, rng));
  if (c.hasHerald) add(ctx.data.aiTuning.priorities.herald, herald(ctx, c));
  objectives(ctx, c, m, add);
  recall(ctx, c, m, add);
  conversion(ctx, c, m, add);
  if (c.role === 'jungle') jungling(ctx, c, m, add);
  else laning(ctx, c, HOME_LANE[c.role], m, add);
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.score - a.score)
    .filter((x) => {
      const key = JSON.stringify(x.order);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Candidates for every ally with an order to give (in ally order); the jungler decides first so laners can join its gank. */
export function planCandidates(ctx: Ctx, mistakes: Mistakes, rng: Rng): Candidate[][] {
  const active = ctx.view.allies.filter((c) => c.status !== 'dead');
  const byId = new Map<string, Candidate[]>();
  const order = [...active].sort((a, b) => Number(b.role === 'jungle') - Number(a.role === 'jungle'));
  for (const c of order) {
    const cs = candidatesFor(ctx, c, mistakes.get(c.id) ?? new Set(), rng);
    byId.set(c.id, cs);
    const best = cs[0]!;
    if (best.gank && best.order.kind === 'move') ctx.gank = { lane: best.gank, target: best.order.to };
    // A champion who rolled a mistake keeps only its chosen order, so the look-ahead cannot undo the mistake;
    // a committed order is kept the same way.
    if ((mistakes.get(c.id)?.size ?? 0) > 0 || best.committed) byId.set(c.id, [best]);
  }
  return active.map((c) => byId.get(c.id)!);
}

/** The best set, then the sets where one champion takes its second choice, cheapest swap first. */
export function candidateSets(per: Candidate[][], n: number): Order[][] {
  const base = per.map((cs) => cs[0]!.order);
  const swaps = per
    .flatMap((cs, i) => (cs.length > 1 ? [{ i, loss: cs[0]!.score - cs[1]!.score, order: cs[1]!.order }] : []))
    .sort((a, b) => a.loss - b.loss || a.i - b.i);
  return [base, ...swaps.slice(0, n - 1).map((s) => base.map((o, j) => (j === s.i ? s.order : o)))];
}

/**
 * Wards the pit one round before its spawn (from or to), and jungler/support unward a pit with an objective
 * up or coming. `poorVision` skips both.
 */
export function assignWards(ctx: Ctx, orders: Order[], mistakes: Mistakes): Order[] {
  const { rules } = ctx.data;
  let wards = 0;
  let unwards = 0;
  const warded = new Set<string>();
  return orders.map((o) => {
    if (o.kind !== 'move' || mistakes.get(o.champion)?.has('poorVision')) return o;
    const c = ctx.view.allies.find((a) => a.id === o.champion)!;
    const out = { ...o };
    for (const [spot, pos] of [['to', o.to], ['from', c.position]] as const) {
      if (!(PITS as string[]).includes(pos)) continue;
      const t = pitTiming(ctx.view, ctx.data, pos as PitId);
      if (!t.objective || (!t.live && !t.soon)) continue;
      if (spot === 'to' && out.unward === undefined && rules.wards.unwardRoles.includes(c.role) && unwards < rules.wards.unwardPerRound) {
        out.unward = 'to';
        unwards++;
      }
      if (t.soon && out.ward === undefined && !warded.has(pos) && wards < rules.wards.perRound) {
        out.ward = spot;
        wards++;
        warded.add(pos);
      }
    }
    return out;
  });
}

/**
 * Lane stances from the predicted fight on each laner's destination, with what `view.side` knows: its laners
 * heading into that lane against the known enemies there. All-in above `aiTuning.allInMargin`, Trade above
 * `tradeMargin`, otherwise (or with no known enemy there, or when the move leaves the home lane) Farm. Set on the
 * order only when it changes.
 */
export function assignStances(ctx: Ctx, orders: Order[]): Order[] {
  const { view, data } = ctx;
  const state = stateFromView(view, data);
  const stage = roundWindow(data.rules, view.round).stage;
  const { allInMargin, tradeMargin } = data.aiTuning;
  return orders.map((o) => {
    const c = view.allies.find((a) => a.id === o.champion)!;
    if (o.kind !== 'move' || c.role === 'jungle') return o;
    const lane = HOME_LANE[c.role];
    // Leaving the home lane drops back to Farm, so no All-in is left behind for the return.
    if (laneOf(data, o.to) !== lane) return c.stance === 'farm' ? o : { ...o, stance: 'farm' };
    const allies = orders.flatMap((x) => {
      const a = view.allies.find((y) => y.id === x.champion)!;
      const laner = a.role !== 'jungle' && HOME_LANE[a.role] === lane;
      return x.kind === 'move' && laner && laneOf(data, x.to) === lane ? [a.id] : [];
    });
    const enemies = view.enemies.filter((e) => known(ctx, e) && laneOf(data, e.position) === lane).map((e) => e.id);
    let stance: Stance = 'farm';
    if (enemies.length > 0) {
      const [blue, red] = ctx.side === 'blue' ? [allies, enemies] : [enemies, allies];
      const { scores } = resolveFight(state, data, o.to, blue, red, stage);
      const margin = scores[ctx.side] - scores[ctx.enemy];
      stance = margin > allInMargin ? 'allin' : margin > tradeMargin ? 'trade' : 'farm';
    }
    return stance === c.stance ? o : { ...o, stance };
  });
}

/** The mistake-free plan (with the profile's `waveSacrifice`), used for the rounds the look-ahead plays after the first. */
export function bestOrders(view: PlayerView, data: GameData, rng: Rng, waveSacrifice: boolean): Order[] {
  const ctx = makeContext(view, data, waveSacrifice);
  const none: Mistakes = new Map(view.allies.map((a) => [a.id, new Set<MistakeId>()]));
  return assignStances(ctx, assignWards(ctx, candidateSets(planCandidates(ctx, none, rng), 1)[0]!, none));
}

/**
 * Contact choice for a prompted contact: fight when the fight is won with what `view.side` knows, otherwise flee,
 * unless `chase` and outnumbered. A contact with a single option (lane contacts resolved from stances) takes it.
 */
export function contactChoice(view: PlayerView, data: GameData, contact: Contact, chase: boolean): Choice {
  const side = view.side;
  const options = contact.options[side];
  if (options.length === 1) return options[0]!;
  const state = stateFromView(view, data);
  const stage = roundWindow(data.rules, view.round).stage;
  const { winner } = resolveFight(state, data, contact.position, contact.blue, contact.red, stage);
  const outnumbered = contact[side].length < contact[other(side)].length;
  const choice: Choice = winner === side || (chase && outnumbered) ? 'fight' : 'flee';
  return options.includes(choice) ? choice : contact.defaults[side];
}
