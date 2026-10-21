import { signal, type Signal } from '@preact/signals';
import type { AiProfile, GameData, Rank, Side } from '@lml/data/contracts';
import type {
  Choice,
  Contact,
  ContactChoices,
  EnemyEstimate,
  EnemyInfo,
  Explanation,
  GameEngine,
  GameEvent,
  GameState,
  Order,
  Orders,
  PlayerView,
  Rng,
  RoundWindow,
  Stance,
  Ward,
  WardSpot,
} from '@lml/engine/contracts';

export type Screen = 'start' | 'orders' | 'contacts' | 'review' | 'over';

export interface Settings {
  rank: Rank;
  teaching: boolean;
  seed: number;
}

/** A side's final score, split as engine.teamScore adds it up. */
export interface ScoreBreakdown {
  gold: number;
  objectives: number;
  plates: number;
  towers: number;
  total: number;
}

export interface Store {
  data: GameData;
  screen: Signal<Screen>;
  view: Signal<PlayerView | null>;
  /** The view before the last resolved round (the replay's starting point); null outside the review and game over screens. */
  previousView: Signal<PlayerView | null>;
  /** The round replay is playing on the map. */
  replaying: Signal<boolean>;
  /** Bumped each time the replay (re)starts. */
  replayRun: Signal<number>;
  selected: Signal<string | null>;
  pending: Signal<Record<string, Order>>;
  /** Contacts the player answers; lane contacts resolved from stances (`auto`) are left out. */
  contacts: Signal<Contact[]>;
  choices: Signal<ContactChoices>;
  lastEvents: Signal<GameEvent[]>;
  explanations: Signal<Explanation[]>;
  settings: Signal<Settings>;
  /** Own champions back at base after a recall (respawning without a death). */
  recalled: Signal<string[]>;
  /** Where the player dragged the actions panel (top-left, shares 0..1 of the map box), kept for the session; null: next to the pawn. */
  panelAt: Signal<{ x: number; y: number } | null>;
  /** The actions panel is being dragged: map clicks are ignored meanwhile. */
  panelDragging: Signal<boolean>;
  /** Champions whose objective prompt was answered this order phase (shown once per round and champion). */
  objectivePromptsClosed: Signal<string[]>;
  start(s: Settings): void;
  /** Back to the start screen, dropping the current game. */
  reset(): void;
  select(id: string | null): void;
  reachableForSelected(): Record<string, number>;
  /** Steps every champion may take this round. */
  stepBudget(): number;
  /** A position `distance` steps away lets the champion act on arrival this round. */
  canAct(distance: number): boolean;
  /** The player's side's deterministic shortest path, both ends included. */
  route(from: string, to: string): string[];
  /** Rounds an own ward stays active, seen from the view's round (1 = its last active round). */
  wardRoundsLeft(ward: Ward): number;
  /** Stays on the pit to take its objective, and closes the champion's objective prompt. */
  doObjective(champion: string): void;
  /** Closes the champion's objective prompt and selects it for another order. */
  otherOrder(champion: string): void;
  setMove(champion: string, to: string): void;
  setWard(champion: string, spot: WardSpot | null): void;
  setUnward(champion: string, spot: 'from' | 'to' | null): void;
  /** Recalls; after a pending 1-step move the champion walks there first (recall `to`). */
  setRecall(champion: string): void;
  /** Sets the champion's lane stance on its order (the pending one, else its default order). */
  setStance(champion: string, stance: Stance): void;
  setSpawn(champion: string, to: string): void;
  clearOrder(champion: string): void;
  confirmRound(): void;
  choose(contactId: string, choice: Choice): void;
  confirmContacts(): void;
  next(): void;
  /** Restarts the round replay (review and game over screens). */
  replay(): void;
  /** Jumps to the end of the round replay. */
  skipReplay(): void;
  /** Time window of `round` (default: the current round, capped at the last one). */
  roundWindow(round?: number): RoundWindow;
  totalRounds(): number;
  level(xp: number): number;
  /** What the player assumes a visible enemy has (engine estimate, fog of war holds). */
  estimateEnemy(enemy: EnemyInfo): EnemyEstimate;
  spawnPointsFor(champion: string): string[];
  setLaunchHerald(champion: string, on: boolean): void;
  /** Both sides' scores once the game is over, otherwise null. */
  finalScores(): Record<Side, ScoreBreakdown> | null;
}

/** Contacts the player answers: automatic ones (lane stances, lane pressure) resolve without a prompt. */
export const promptContacts = (contacts: Contact[]): Contact[] => contacts.filter((c) => !c.auto);

const PLAYER: Side = 'blue';
const ENEMY: Side = 'red';

export function createStore(data: GameData, engine: GameEngine): Store {
  const screen = signal<Screen>('start');
  const view = signal<PlayerView | null>(null);
  const previousView = signal<PlayerView | null>(null);
  const replaying = signal(false);
  const replayRun = signal(0);
  const selected = signal<string | null>(null);
  const pending = signal<Record<string, Order>>({});
  const contacts = signal<Contact[]>([]);
  const choices = signal<ContactChoices>({});
  const lastEvents = signal<GameEvent[]>([]);
  const explanations = signal<Explanation[]>([]);
  const settings = signal<Settings>({ rank: 'gold', teaching: true, seed: 1 });
  const recalled = signal<string[]>([]);
  const panelAt = signal<{ x: number; y: number } | null>(null);
  const panelDragging = signal(false);
  const objectivePromptsClosed = signal<string[]>([]);

  // The full state never leaves the store; components only see `view`.
  let state: GameState | null = null;
  let profile: AiProfile | null = null;
  let aiRng: Rng | null = null;
  let roundOrders: Orders | null = null;
  let redChoices: ContactChoices = {};

  const current = (): GameState => {
    if (!state) throw new Error('game not started');
    return state;
  };

  const publish = (): void => {
    view.value = engine.viewFor(current(), data, PLAYER);
  };

  /** Pending orders over the defaults, one per champion that can act. */
  const blueOrders = (pend: Record<string, Order>): Order[] =>
    engine.defaultOrders(current(), data, PLAYER).map((d) => pend[d.champion] ?? d);

  /** Throws the engine's validation error when `order` does not fit; otherwise stores it. */
  const place = (order: Order): void => {
    const next = { ...pending.value, [order.champion]: order };
    engine.validateOrders(current(), data, PLAYER, blueOrders(next));
    pending.value = next;
  };

  const champion = (id: string) => {
    const c = current().champions.find((x) => x.id === id && x.side === PLAYER);
    if (!c) throw new Error(`${id}: not a ${PLAYER} champion`);
    return c;
  };

  /** Up by the end of the round as far as the player knows (its view's camp timers, never the hidden state). */
  const campAlive = (id: string): boolean => {
    const s = current();
    return (view.value?.camps[id] ?? 0) <= engine.roundWindow(data.rules, s.round).end;
  };

  /** First intermediate step of a shortest path to a 2-step target; fast clearers prefer an alive own camp. */
  const viaFor = (id: string, to: string): string | undefined => {
    const c = champion(id);
    const { graph, rules } = data;
    const best = engine.bestVia(current(), data, id, to);
    if (best === undefined) return undefined;
    const mids = (graph.adj[c.position] ?? []).filter((n) => n !== `base-${ENEMY}` && graph.distance(n, to) === 1 && !engine.isLaneChange(data, c.position, n));
    const fast = c.role === 'jungle' && (data.champions[id]?.clearSpeed ?? 0) >= rules.camps.fastClearAt;
    if (fast) {
      const camp = mids.find((n) => {
        const p = graph.positions[n];
        return p?.kind === 'camp' && p.side === PLAYER && campAlive(n);
      });
      if (camp) return camp;
    }
    return best;
  };

  const existingMove = (id: string): Extract<Order, { kind: 'move' }> | null => {
    const o = pending.value[id];
    return o?.kind === 'move' ? o : null;
  };

  /** The pending move to amend, else the engine's default (a laner in its lane follows its wave), else stay put. */
  const moveBase = (id: string): Extract<Order, { kind: 'move' }> => {
    const prev = existingMove(id);
    if (prev) return { ...prev };
    const def = engine.defaultOrders(current(), data, PLAYER).find((o) => o.champion === id);
    return def?.kind === 'move' ? { ...def } : { kind: 'move', champion: id, to: champion(id).position };
  };

  const resolve = (): void => {
    const before = current();
    const orders = roundOrders;
    if (!orders) throw new Error('no round in progress');
    const full: ContactChoices = {};
    for (const c of contacts.value) {
      full[c.id] = { blue: choices.value[c.id]?.blue ?? c.defaults.blue, red: redChoices[c.id]?.red ?? c.defaults.red };
    }
    const result = engine.resolveRound(before, data, orders, full);
    state = result.state;
    roundOrders = null;
    lastEvents.value = engine.eventsFor(result.events, result.state, data, PLAYER);
    const back = new Set(recalled.value);
    for (const e of result.events) {
      if (e.type === 'recall') back.add(e.champion);
      else if (e.type === 'death') back.delete(e.champion);
    }
    recalled.value = result.state.champions
      .filter((c) => c.side === PLAYER && c.status === 'respawning' && back.has(c.id))
      .map((c) => c.id);
    explanations.value = settings.value.teaching
      ? engine.explainRound(before, result.state, result.events, data, PLAYER)
      : [];
    previousView.value = view.value;
    publish();
    screen.value = result.state.over ? 'over' : 'review';
    startReplay();
  };

  const startReplay = (): void => {
    replayRun.value += 1;
    replaying.value = true;
  };
  const stopReplay = (): void => {
    replaying.value = false;
  };

  const breakdown = (s: GameState, side: Side): ScoreBreakdown => {
    const { objectives: rules, verdict } = data.rules;
    const gold = s.champions.filter((c) => c.side === side).reduce((sum, c) => sum + c.goldEarned, 0);
    const objectives = Object.entries(s.objectivesTaken[side])
      .reduce((sum, [id, n]) => sum + (n ?? 0) * rules[id as keyof typeof rules].value, 0);
    const plates = s.platesTaken[side] * verdict.plateValue;
    const towers = s.towersDestroyed[side] * verdict.towerValue;
    return { gold, objectives, plates, towers, total: engine.teamScore(s, data, side) };
  };

  return {
    data, screen, view, previousView, replaying, replayRun, selected, pending, contacts, choices, lastEvents, explanations, settings, recalled,
    panelAt, panelDragging, objectivePromptsClosed,

    start(s) {
      settings.value = s;
      profile = data.aiProfiles.find((p) => p.rank === s.rank) ?? null;
      if (!profile) throw new Error(`no AI profile for rank ${s.rank}`);
      state = engine.newGame(data, s.seed);
      aiRng = engine.createRng(s.seed + 1);
      roundOrders = null;
      redChoices = {};
      selected.value = null;
      pending.value = {};
      contacts.value = [];
      choices.value = {};
      lastEvents.value = [];
      explanations.value = [];
      recalled.value = [];
      objectivePromptsClosed.value = [];
      previousView.value = null;
      stopReplay();
      panelDragging.value = false;
      publish();
      screen.value = 'orders';
    },

    reset() {
      state = null;
      roundOrders = null;
      redChoices = {};
      selected.value = null;
      pending.value = {};
      contacts.value = [];
      choices.value = {};
      lastEvents.value = [];
      explanations.value = [];
      recalled.value = [];
      objectivePromptsClosed.value = [];
      previousView.value = null;
      stopReplay();
      panelDragging.value = false;
      view.value = null;
      screen.value = 'start';
    },

    select(id) {
      selected.value = id;
    },

    reachableForSelected() {
      const id = selected.value;
      if (!id || !state) return {};
      const c = state.champions.find((x) => x.id === id && x.side === PLAYER);
      return c && c.status === 'alive' ? engine.reachable(state, data, id) : {};
    },

    stepBudget() {
      return engine.stepBudget(data.rules, current().round);
    },

    canAct(distance) {
      return engine.canAct(distance, engine.stepBudget(data.rules, current().round));
    },

    route(from, to) {
      return engine.route(data, from, to, PLAYER);
    },

    wardRoundsLeft(ward) {
      return engine.wardRoundsLeft(ward, view.value?.round ?? current().round, data.rules);
    },

    doObjective(id) {
      this.setMove(id, champion(id).position);
      objectivePromptsClosed.value = [...objectivePromptsClosed.value, id];
    },

    otherOrder(id) {
      objectivePromptsClosed.value = [...objectivePromptsClosed.value, id];
      selected.value = id;
    },

    setMove(id, to) {
      const prev = existingMove(id);
      const via = viaFor(id, to);
      const order: Order = { kind: 'move', champion: id, to };
      if (via !== undefined) order.via = via;
      if (prev?.ward !== undefined) order.ward = prev.ward;
      if (prev?.unward !== undefined) order.unward = prev.unward;
      if (prev?.launchHerald) order.launchHerald = true;
      const stance = pending.value[id]?.stance;
      if (stance !== undefined) order.stance = stance;
      place(order);
    },

    setWard(id, spot) {
      const prev = pending.value[id];
      if (prev?.kind === 'recall') {
        if (spot !== null && spot !== 'from' && spot !== 'to') throw new Error(`${id}: a recall can only ward its start or step position`);
        const { ward: _drop, ...rest } = prev;
        place(spot === null ? rest : { ...rest, ward: spot });
        return;
      }
      const base = moveBase(id);
      delete base.ward;
      if (spot !== null) base.ward = spot;
      place(base);
    },

    setUnward(id, spot) {
      const prev = pending.value[id];
      if (prev?.kind === 'recall') {
        const { unward: _drop, ...rest } = prev;
        place(spot === null ? rest : { ...rest, unward: spot });
        return;
      }
      const base = moveBase(id);
      delete base.unward;
      if (spot !== null) base.unward = spot;
      place(base);
    },

    setRecall(id) {
      const prev = pending.value[id];
      if (prev?.kind === 'recall') return;
      const order: Extract<Order, { kind: 'recall' }> = { kind: 'recall', champion: id };
      if (prev?.kind === 'move') {
        // The recall is the action: its step must leave a step of the budget for it.
        const d = data.graph.distance(champion(id).position, prev.to);
        const step = d > 0 && engine.canAct(d, engine.stepBudget(data.rules, current().round));
        if (prev.ward === 'from' || (prev.ward === 'to' && step)) order.ward = prev.ward;
        if (prev.unward !== undefined && (step || prev.unward === 'from')) order.unward = prev.unward;
        if (step) order.to = prev.to;
      }
      if (prev?.stance !== undefined) order.stance = prev.stance;
      place(order);
    },

    setStance(id, stance) {
      champion(id);
      const prev = pending.value[id] ?? engine.defaultOrders(current(), data, PLAYER).find((o) => o.champion === id);
      if (!prev) throw new Error(`${id}: takes no order this round`);
      place({ ...prev, stance });
    },

    setSpawn(id, to) {
      const stance = pending.value[id]?.stance;
      place(stance === undefined ? { kind: 'spawn', champion: id, to } : { kind: 'spawn', champion: id, to, stance });
    },

    clearOrder(id) {
      const { [id]: _removed, ...rest } = pending.value;
      pending.value = rest;
    },

    confirmRound() {
      if (screen.value !== 'orders') throw new Error('not in the orders stage');
      const s = current();
      const blue = blueOrders(pending.value);
      engine.validateOrders(s, data, PLAYER, blue);
      panelDragging.value = false;
      const red = engine.aiOrders(engine.viewFor(s, data, ENEMY), data, profile!, aiRng!);
      roundOrders = { blue, red };
      const involving = promptContacts(engine.detectContacts(s, data, roundOrders).filter((c) => c.blue.length > 0));
      const redView = engine.viewFor(s, data, ENEMY);
      redChoices = {};
      for (const c of involving) {
        redChoices[c.id] = { red: engine.aiContactChoice(redView, data, c, profile!, aiRng!) };
      }
      contacts.value = involving;
      choices.value = {};
      if (involving.length === 0) resolve();
      else screen.value = 'contacts';
    },

    choose(contactId, choice) {
      const c = contacts.value.find((x) => x.id === contactId);
      if (!c) throw new Error(`${contactId}: unknown contact`);
      if (!c.options.blue.includes(choice)) throw new Error(`${contactId}: ${choice} is not an option`);
      choices.value = { ...choices.value, [contactId]: { blue: choice } };
    },

    confirmContacts() {
      if (screen.value !== 'contacts') return;
      panelDragging.value = false;
      resolve();
    },

    next() {
      if (screen.value !== 'review') return;
      pending.value = {};
      selected.value = null;
      contacts.value = [];
      choices.value = {};
      objectivePromptsClosed.value = [];
      previousView.value = null;
      stopReplay();
      panelDragging.value = false;
      screen.value = 'orders';
    },

    replay() {
      if ((screen.value === 'review' || screen.value === 'over') && previousView.value) startReplay();
    },

    skipReplay() {
      stopReplay();
    },

    roundWindow(round) {
      const total = engine.totalRounds(data.rules);
      return engine.roundWindow(data.rules, Math.min(round ?? current().round, total));
    },

    totalRounds() {
      return engine.totalRounds(data.rules);
    },

    level(xp) {
      return engine.level(xp, data.rules);
    },

    estimateEnemy(enemy) {
      return engine.estimateEnemy(view.value ?? engine.viewFor(current(), data, PLAYER), data, enemy);
    },

    spawnPointsFor(id) {
      champion(id);
      return engine.spawnPoints(current(), data, id);
    },

    setLaunchHerald(id, on) {
      const base = moveBase(id);
      delete base.launchHerald;
      if (on) base.launchHerald = true;
      place(base);
    },

    finalScores() {
      const s = state;
      if (!s?.over) return null;
      return { blue: breakdown(s, PLAYER), red: breakdown(s, ENEMY) };
    },
  };
}
