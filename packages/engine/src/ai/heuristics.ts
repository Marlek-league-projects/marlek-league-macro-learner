import { MISTAKE_IDS, mirrorId } from '@lml/data';
import type { AiProfile, GameData, Lane, MistakeId, ObjectiveId, Role, Side } from '@lml/data/contracts';
import type { ChampionState, Choice, Contact, EnemyInfo, GameState, Order, PlayerView, Rng, Stance } from '../contracts';
import { fightPosition, gankedSide } from '../contacts';
import { resolveFight } from '../fight';
import { budgetFrom, canAct, reachableFrom, spawnPointsFor, stepBudget } from '../movement';
import { type PitId, SCUTTLE_PIT } from '../objectives';
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
   * Kept over the look-ahead: a laner's paying rotation, which cannot value the numbers it brings (simulated
   * enemies stand still), or a wounded laner's recall (the evaluation does not value health).
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
  /** `stateFromView(view)`, built on first use for predicted fights. */
  state?: GameState;
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

/** Steps every champion may take in the view's round. */
const budget = (ctx: Ctx): number => stepBudget(ctx.data.rules, ctx.view.round);
/** `c`'s own steps this round: `budget`, plus the base's extra steps when it starts on its base. */
const budgetOf = (ctx: Ctx, c: ChampionState): number => budgetFrom(ctx.data.rules, ctx.view.round, c.position, c.side);

/**
 * Hard rule, never a mistake: an AI champion ends on a standing enemy tower only when it is that lane's front tower
 * and the AI's wave is at it. A destroyed tower's position is no longer under a tower.
 */
export function towerAllowed(ctx: Ctx, position: string): boolean {
  const p = ctx.data.graph.positions[position];
  if (p?.kind !== 'tower' || p.side !== ctx.enemy || (ctx.view.towers[position] ?? 0) <= 0) return true;
  return position === front(ctx, ctx.enemy, p.lane!) && ourWave(ctx.view, p.lane!) === 1;
}

/** Positions `c` may end on this round (`towerAllowed`), with their distance; with none, its own position. */
function reach(ctx: Ctx, c: ChampionState): Record<string, number> {
  const all = reachableFrom(ctx.data, c.position, budgetOf(ctx, c), c.side);
  const out = Object.fromEntries(Object.entries(all).filter(([p]) => towerAllowed(ctx, p)));
  return Object.keys(out).length > 0 ? out : { [c.position]: 0 };
}

/** `c` reaches `pos` this round with a step left to act there (clear, take, farm). */
function actsOn(ctx: Ctx, c: ChampionState, pos: string): boolean {
  const d = reach(ctx, c)[pos];
  return d !== undefined && canAct(d, budgetOf(ctx, c));
}

/**
 * How a laner likes to walk through `pos` when routes tie: lane positions (and bases) first, then the river
 * (scuttles, pits), then its own camps, then enemy camps. A jungler has no preference.
 */
function routeRank(ctx: Ctx, c: ChampionState, pos: string): number {
  if (c.role === 'jungle') return 0;
  const p = ctx.data.graph.positions[pos]!;
  if (p.kind === 'tower' || p.kind === 'laneMid' || p.kind === 'base') return 0;
  if (p.kind === 'scuttle' || p.kind === 'pit') return 1;
  return p.side === ctx.side ? 2 : 3;
}

/** A position id as blue would see it: red compares mirrored ids, so both sides break ties alike. */
const seenFromBlue = (ctx: Ctx, id: string): string => (ctx.side === 'blue' ? id : mirrorId(id));

/**
 * Reachable position closest to `target` among those passing `where`, or null; ties: fewest moves, then
 * `routeRank`, then id seen from blue (red picks the mirror of blue's choice).
 */
function closest(ctx: Ctx, c: ChampionState, target: string, where: (pos: string, steps: number) => boolean): string | null {
  const r = reach(ctx, c);
  return (
    Object.keys(r)
      .filter((p) => where(p, r[p]!))
      .sort(
        (a, b) =>
          dist(ctx.data, a, target) - dist(ctx.data, b, target) ||
          r[a]! - r[b]! ||
          routeRank(ctx, c, a) - routeRank(ctx, c, b) ||
          seenFromBlue(ctx, a).localeCompare(seenFromBlue(ctx, b)),
      )[0] ?? null
  );
}

/** Reachable position closest to `target` (a walk toward it: arriving may leave no step to act). */
function step(ctx: Ctx, c: ChampionState, target: string): string {
  return closest(ctx, c, target, () => true)!;
}

/** Position closest to `target` among those passing `where` where `c` still has a step left to act, or null. */
function actStep(ctx: Ctx, c: ChampionState, target: string, where: (pos: string) => boolean): string | null {
  return closest(ctx, c, target, (p, steps) => canAct(steps, budgetOf(ctx, c)) && where(p));
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

/** The view's own-side camp timers (the view also holds the enemy camp timers the side knows). */
function ownCamps(ctx: Ctx): [string, number][] {
  return Object.entries(ctx.view.camps).filter(([id]) => ctx.data.graph.positions[id]?.side === ctx.side);
}

/**
 * Where `c` respawns, among the positions its move from the base reaches (nearest first): the jungler an own camp up,
 * one it acts on first, a buff first; a laner its home lane's front standing tower, else the point nearest its lane.
 */
function spawnOrder(ctx: Ctx, c: ChampionState): Order {
  const { data } = ctx;
  const points = spawnPointsFor(ctx.view, data, c.id);
  const base = `base-${c.side}`;
  const steps = budgetFrom(data.rules, ctx.view.round, base, c.side);
  const from = reachableFrom(data, base, steps, c.side);
  let to: string;
  if (c.role === 'jungle') {
    const camps = points.filter((p) => data.graph.positions[p]!.kind === 'camp' && data.graph.positions[p]!.side === c.side);
    const up = camps.filter((p) => (ctx.view.camps[p] ?? Infinity) <= ctx.end);
    const acting = up.filter((p) => canAct(from[p]!, steps));
    const buff = (ps: string[]): string | undefined => ps.find((p) => /^(blue|red)buff-/.test(p));
    to = buff(acting) ?? acting[0] ?? buff(up) ?? up[0] ?? camps[0] ?? points[0]!;
  } else {
    const lane = HOME_LANE[c.role];
    const tower = front(ctx, c.side, lane);
    const mid = laneMid(data, lane);
    to = tower !== null && points.includes(tower) ? tower : [...points].sort((a, b) => dist(data, a, mid) - dist(data, b, mid))[0]!;
  }
  return { kind: 'spawn', champion: c.id, to };
}

/** Back to lane for a laner, to the nearest own camp for the jungler. */
function home(ctx: Ctx, c: ChampionState): Order {
  if (c.role !== 'jungle') {
    const lane = HOME_LANE[c.role];
    return moveTo(c, step(ctx, c, front(ctx, ctx.side, lane) ?? laneMid(ctx.data, lane)));
  }
  const camps = ownCamps(ctx).map(([id]) => id).sort((a, b) => dist(ctx.data, c.position, a) - dist(ctx.data, c.position, b));
  return moveTo(c, step(ctx, c, camps[0] ?? c.position));
}

/** Where `pointlessPlay` wanders: its own side's camps, the river (Scuttles, pits) and its own lane's positions. */
function wanderSpot(ctx: Ctx, c: ChampionState, pos: string): boolean {
  const p = ctx.data.graph.positions[pos]!;
  if (p.kind === 'camp') return p.side === ctx.side;
  if (p.kind === 'scuttle' || p.kind === 'pit') return true;
  return c.role !== 'jungle' && p.lane === HOME_LANE[c.role];
}

/**
 * `pointlessPlay`: a random move within the champion's `wanderSpot`s (and `towerAllowed`); with none, it stays, or
 * goes to the closest allowed position.
 */
function pointless(ctx: Ctx, c: ChampionState, rng: Rng): Order {
  const pool = Object.keys(reach(ctx, c))
    .sort()
    .filter((p) => p !== c.position && wanderSpot(ctx, c, p));
  return moveTo(c, pool.length > 0 ? rng.pick(pool) : step(ctx, c, c.position));
}

/**
 * Launch the Herald on an enemy front tower in reach where the wave is (`towerAllowed`), otherwise walk toward the
 * nearest one.
 */
function herald(ctx: Ctx, c: ChampionState): Order {
  const r = reach(ctx, c);
  const targets = LANES.map((l) => front(ctx, ctx.enemy, l)).filter((t): t is string => t !== null);
  const inRange = targets.find((t) => r[t] !== undefined);
  if (inRange) return { kind: 'move', champion: c.id, to: inRange, launchHerald: true };
  const nearest = [...targets].sort((a, b) => dist(ctx.data, c.position, a) - dist(ctx.data, c.position, b))[0];
  return moveTo(c, nearest ? step(ctx, c, nearest) : step(ctx, c, c.position));
}

/**
 * A laner leaving its lane for `pit` pays (only for profiles with `waveSacrifice`): the objective is worth more than `aiTuning.waveSacrificeCost` (the wave
 * it gives up) and the champion's arrival gives its side the numbers there. Allies count, and known enemies (seen
 * within `aiTuning.knownRounds`) count against, when within a round's step budget of the pit; the laner must be too.
 */
function rotationPays(ctx: Ctx, c: ChampionState, pit: PitId, objective: ObjectiveId): boolean {
  const { data } = ctx;
  const rule = data.rules.objectives[objective];
  if (!ctx.waveSacrifice || c.role === 'jungle' || rule.value <= data.aiTuning.waveSacrificeCost) return false;
  const near = (pos: string): boolean => dist(data, pos, pit) <= budget(ctx);
  if (!near(c.position)) return false;
  const ours = ctx.view.allies.filter((a) => a.status === 'alive' && near(a.position)).length;
  const theirs = ctx.view.enemies.filter((e) => known(ctx, e) && near(e.position)).length;
  return ours >= rule.minChampions && ours > theirs;
}

/**
 * The known enemies within a round's step budget of `pit` beat the group `c` would fight with there (itself and the alive
 * allies within a round's step budget), by the predicted fight `contactChoice` uses: walking in would only end in a flee.
 */
function pitLost(ctx: Ctx, c: ChampionState, pit: PitId): boolean {
  const { data, view } = ctx;
  const near = (pos: string): boolean => dist(data, pos, pit) <= budget(ctx);
  const theirs = view.enemies.filter((e) => known(ctx, e) && near(e.position)).map((e) => e.id);
  if (theirs.length === 0) return false;
  const ours = view.allies.filter((a) => a.status === 'alive' && (a.id === c.id || near(a.position))).map((a) => a.id);
  ctx.state ??= stateFromView(view, data);
  const [blue, red] = ctx.side === 'blue' ? [ours, theirs] : [theirs, ours];
  return resolveFight(ctx.state, data, pit, blue, red, roundWindow(data.rules, view.round).stage).winner !== ctx.side;
}

/** The view's round starts before `aiTuning.laningPhaseUntil`. */
function inLaningPhase(ctx: Ctx): boolean {
  return roundWindow(ctx.data.rules, ctx.view.round).start < ctx.data.aiTuning.laningPhaseUntil;
}

/**
 * A paying rotation a laner may take in the laning phase: top and bot to the pit on their half of the map (a wave
 * sacrifice is allowed); mid, equally far from both pits, only with lane priority (its wave pushed to the enemy).
 */
function laningRotation(ctx: Ctx, c: ChampionState, pit: PitId): boolean {
  if (c.role === 'jungle') return true;
  const lane = HOME_LANE[c.role];
  const h = half(ctx.data, laneMid(ctx.data, lane));
  return h === null ? ourWave(ctx.view, lane) === 1 : h === pit;
}

/**
 * Objective setup: to the pit one round before spawn (or while up), for the objective's roles with lane priority
 * (`rotateWithoutPriority` drops that check), or for any laner whose rotation pays, wave sacrificed if needed.
 * In the laning phase a laner only leaves its wave for a paying rotation allowed by `laningRotation`, or with
 * `rotateWithoutPriority`. A pit whose known enemies would win the fight there (`pitLost`) is skipped.
 */
function objectives(ctx: Ctx, c: ChampionState, m: Set<MistakeId>, add: (s: number, o: Order, x?: Extra) => void): void {
  for (const pit of PITS) {
    const t = pitTiming(ctx.view, ctx.data, pit);
    if (!t.objective || (!t.live && !t.soon)) continue;
    if (t.soon && m.has('objectiveTiming')) continue;
    const roles = PIT_ROLES[t.objective];
    const able = ctx.view.allies.filter((a) => a.status !== 'dead' && roles.includes(a.role)).length;
    const lane = c.role === 'jungle' ? PIT_LANE[pit] : HOME_LANE[c.role];
    const held = c.role !== 'jungle' && inLaningPhase(ctx);
    const assigned =
      roles.includes(c.role) &&
      able >= ctx.data.rules.objectives[t.objective].minChampions &&
      (m.has('rotateWithoutPriority') || (!held && ourWave(ctx.view, lane) >= 0));
    const pays = !assigned && (!held || laningRotation(ctx, c, pit)) && rotationPays(ctx, c, pit, t.objective);
    if ((!assigned && !pays) || pitLost(ctx, c, pit)) continue;
    // A live objective is taken by acting on the pit; arriving there with no step left loses the round.
    const lost = t.live && !actsOn(ctx, c, pit);
    const score = ctx.data.aiTuning.priorities.objective - (lost ? ctx.data.aiTuning.walkPenalty : 0);
    add(score, moveTo(c, step(ctx, c, pit)), pays ? { committed: true } : undefined);
  }
}

/**
 * Recall with `recallGold` unspent, or as a laner under `recallHp`, on a shoved or even wave (no objective coming
 * for the jungler); `badRecall` inverts it. A wounded laner's recall is committed.
 */
function recall(ctx: Ctx, c: ChampionState, m: Set<MistakeId>, add: (s: number, o: Order, extra?: Extra) => void): void {
  const { recallGold, recallHp } = ctx.data.aiTuning;
  const wounded = c.role !== 'jungle' && c.hp < recallHp;
  if (c.gold < recallGold && !wounded) return;
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
  add(ctx.data.aiTuning.priorities.recall, order, wounded ? { committed: true } : undefined);
}

/**
 * Pushing the enemy front tower of `lane` is safe: the enemy jungler is known (seen within
 * `aiTuning.knownRounds`) and out of its range of that tower. `greed` skips the check.
 */
function pushSafe(ctx: Ctx, lane: Lane, m: Set<MistakeId>): boolean {
  if (m.has('greed')) return true;
  const target = front(ctx, ctx.enemy, lane);
  const jg = ctx.jungler;
  return target !== null && known(ctx, jg) && dist(ctx.data, jg.position, target) > budget(ctx);
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
      watchers.some((a) => dist(data, a.previous, e.position!) <= budget(ctx)),
  );
  if (laners.length === 0 || !fought) return;
  add(data.aiTuning.priorities.convert, m.has('noConversion') ? home(ctx, c) : moveTo(c, step(ctx, c, target)));
}

/**
 * Laner: farm in lane, step onto the enemy front tower when the wave is there and the enemy jungler is known far.
 * Farming needs a step left: the laner stops on the lane position closest to its spot where it still acts, or walks
 * toward the spot with `walkPenalty` when it acts on no position of its lane. Pushing a tower only needs presence.
 */
function laning(ctx: Ctx, c: ChampionState, lane: Lane, m: Set<MistakeId>, add: (s: number, o: Order) => void): void {
  const { view, data } = ctx;
  const wave = ourWave(view, lane);
  const enemyFront = front(ctx, ctx.enemy, lane);
  const mid = laneMid(data, lane);
  const own = front(ctx, ctx.side, lane) ?? mid;
  const jg = ctx.jungler;
  const threatened = !m.has('ignoreJungler') && known(ctx, jg) && dist(data, jg.position, mid) <= budget(ctx);
  let spot: string;
  if (wave === 1 && enemyFront && pushSafe(ctx, lane, m)) spot = enemyFront;
  else if (wave === 1 && !threatened) spot = mid;
  else spot = own;
  const { priorities, walkPenalty } = ctx.data.aiTuning;
  const farm = (target: string, priority: number): void => {
    if (target === enemyFront) return add(priority, moveTo(c, step(ctx, c, target)));
    const at = actStep(ctx, c, target, (p) => laneOf(data, p) === lane);
    add(at ? priority : priority - walkPenalty, moveTo(c, at ?? step(ctx, c, target)));
  };
  farm(spot, priorities.lane);
  farm(spot === own ? mid : own, priorities.laneAlt);
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
      if ((h !== null && h === half(data, mid)) || dist(data, jg.position, mid) <= budget(ctx)) continue;
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

  // Clearing a camp or taking a Scuttle needs a step left; one only arrived at is a walk that loses the round.
  const take = (pos: string, priority: number): void => {
    if (r[pos] === undefined) return;
    add(actsOn(ctx, c, pos) ? priority : priority - ctx.data.aiTuning.walkPenalty, moveTo(c, pos));
  };
  for (const id of SCUTTLES) {
    if (view.scuttles[id] <= ctx.end) take(id, ctx.data.aiTuning.priorities.scuttle);
  }
  for (const [camp, t] of ownCamps(ctx)) {
    if (t > ctx.end) continue;
    const buff = /^(blue|red)buff-/.test(camp);
    take(camp, buff ? ctx.data.aiTuning.priorities.buff : ctx.data.aiTuning.priorities.camp);
  }
  if (jgKnown) {
    // Enemy camps known to be down (their timer is known) are not invaded.
    const opposite = half(data, jg.position);
    for (const p of Object.keys(r).sort()) {
      const pos = data.graph.positions[p]!;
      const h = half(data, p);
      const up = (view.camps[p] ?? 0) <= ctx.end;
      if (pos.kind === 'camp' && pos.side === ctx.enemy && up && opposite !== null && h !== null && h !== opposite) {
        take(p, ctx.data.aiTuning.priorities.invade);
      }
    }
  }
  const soonest = ownCamps(ctx).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
  add(ctx.data.aiTuning.priorities.wait, moveTo(c, soonest ? step(ctx, c, soonest[0]) : step(ctx, c, c.position)));
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
 * The enemy jungler may gank `pos`: unseen (not known), or known within `aiTuning.pushJunglerDistance` of it.
 */
function junglerThreat(ctx: Ctx, pos: string): boolean {
  if (!known(ctx, ctx.jungler)) return true;
  return dist(ctx.data, ctx.jungler.position, pos) <= ctx.data.aiTuning.pushJunglerDistance;
}

/**
 * Lane stances from the predicted fight where the lane contact would resolve (`fightPosition`), with what `view.side`
 * knows: its laners heading into that lane against the known enemies there, where they were last seen. All-in above
 * `aiTuning.allInMargin`, Trade above `tradeMargin`, otherwise (or with no known enemy there, when the move leaves the
 * home lane, or on a recall) Farm. A Farm with lane pressure (above `pushMargin`) and no enemy jungler threat becomes
 * Push. Set on the order only when it changes.
 */
export function assignStances(ctx: Ctx, orders: Order[]): Order[] {
  const { view, data } = ctx;
  const state = stateFromView(view, data);
  const stage = roundWindow(data.rules, view.round).stage;
  const { allInMargin, tradeMargin, pushMargin } = data.aiTuning;
  return orders.map((o) => {
    const c = view.allies.find((a) => a.id === o.champion)!;
    if (o.kind === 'spawn' || c.role === 'jungle') return o;
    const lane = HOME_LANE[c.role];
    // Leaving the home lane (a recall too) drops back to Farm, so no All-in is left behind for the return.
    if (o.kind === 'recall' || laneOf(data, o.to) !== lane) return c.stance === 'farm' ? o : { ...o, stance: 'farm' };
    const allies = orders.flatMap((x) => {
      const a = view.allies.find((y) => y.id === x.champion)!;
      const laner = a.role !== 'jungle' && HOME_LANE[a.role] === lane;
      return x.kind === 'move' && laner && laneOf(data, x.to) === lane ? [a.id] : [];
    });
    const enemies = view.enemies.filter((e) => known(ctx, e) && laneOf(data, e.position) === lane).map((e) => e.id);
    let stance: Stance = 'farm';
    if (enemies.length > 0) {
      const [blue, red] = ctx.side === 'blue' ? [allies, enemies] : [enemies, allies];
      const arrival: Record<string, string> = {};
      for (const x of orders) if (allies.includes(x.champion) && x.kind === 'move') arrival[x.champion] = x.to;
      for (const e of view.enemies) if (enemies.includes(e.id)) arrival[e.id] = e.position!;
      const { scores } = resolveFight(state, data, fightPosition(data, arrival, blue, red), blue, red, stage);
      const margin = scores[ctx.side] - scores[ctx.enemy];
      stance = margin > allInMargin ? 'allin' : margin > tradeMargin ? 'trade' : 'farm';
      if (stance === 'farm' && margin > pushMargin && !junglerThreat(ctx, o.to)) stance = 'push';
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

/** Something to take in a river contact's zone: its Scuttle up this round, or its pit objective up. */
function riverUp(view: PlayerView, data: GameData, contact: Contact): boolean {
  const end = roundWindow(data.rules, view.round).end;
  return (Object.keys(SCUTTLE_PIT) as (keyof typeof SCUTTLE_PIT)[]).some((scuttle) => {
    const pit = SCUTTLE_PIT[scuttle];
    const here = contact.positions.includes(scuttle) || contact.positions.includes(pit);
    return here && (view.scuttles[scuttle] <= end || view.pits[pit].objective !== null);
  });
}

/**
 * Contact choice for a prompted contact, with what `view.side` knows and the HP the contact shows (contact = vision):
 * - `objective` (keep taking the river objective) when there is one to take and the fight scored at
 *   `fight.objectiveFocus` of our strength is still won;
 * - otherwise `fight` when the fight is won, or when `chase` and outnumbered;
 * - otherwise `farm` under our tower when it is offered and no ganker came (pressure), unless the bigger side would
 *   win by more than `aiTuning.allInMargin` (it would kill us);
 * - otherwise `flee`.
 * A contact with a single option (lane contacts resolved from stances) takes it.
 */
export function contactChoice(view: PlayerView, data: GameData, contact: Contact, chase: boolean): Choice {
  const side = view.side;
  const enemy = other(side);
  const options = contact.options[side];
  if (options.length === 1) return options[0]!;
  const state = stateFromView(view, data);
  // Contact = vision: everyone in the contact is seen, at the HP the contact shows.
  for (const c of state.champions) if (contact.hp[c.id] !== undefined) c.hp = contact.hp[c.id]!;
  const stage = roundWindow(data.rules, view.round).stage;
  const fight = (focus: Partial<Record<Side, number>> = {}) =>
    resolveFight(state, data, contact.position, contact.blue, contact.red, stage, gankedSide(contact), focus);
  const pick = (choice: Choice): Choice => (options.includes(choice) ? choice : contact.defaults[side]);
  if (options.includes('objective') && riverUp(view, data, contact)) {
    if (fight({ [side]: data.rules.fight.objectiveFocus }).winner === side) return 'objective';
  }
  const { winner, scores } = fight();
  const outnumbered = contact[side].length < contact[enemy].length;
  if (winner === side || (chase && outnumbered)) return pick('fight');
  const safe = scores[enemy] - scores[side] <= data.aiTuning.allInMargin;
  if (options.includes('farm') && contact.kind !== 'gank' && safe) return 'farm';
  return pick('flee');
}
