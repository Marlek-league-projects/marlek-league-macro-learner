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
  /** Steps every champion may take this round; arriving on the last one leaves no action. */
  stepBudget(): number;
  /** A position `distance` steps away lets the champion act on arrival this round. */
  canAct(distance: number): boolean;
  /** The path the engine walks for an own champion's move to `to`, both ends included. */
  routeOf(champion: string, to: string): string[];
  /** A move to `to` can come before a recall: it leaves a step of the budget for the recall. */
  recallStep(champion: string, to: string): boolean;
  /** Rounds an own ward stays active, seen from the view's round (1 = its last active round). */
  wardRoundsLeft(ward: Ward): number;
  /** Stays on the pit to take its objective, and closes the champion's objective prompt. */
  doObjective(champion: string): void;
  /** Closes the champion's objective prompt and selects it for another order. */
  otherOrder(champion: string): void;
  setMove(champion: string, to: string): void;
  setWard(champion: string, spot: WardSpot | null): void;
  setUnward(champion: string, spot: 'from' | 'to' | null): void;
  /** Recalls; after a pending move that leaves a step (`recallStep`) the champion walks there first (recall `to`). */
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

/** The player's preselected choice in a contact: keep on the objective when offered, otherwise the contact default. */
export const playerDefault = (contact: Contact): Choice =>
  contact.options.blue.includes('objective') ? 'objective' : contact.defaults.blue;

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

  const budget = (): number => engine.stepBudget(data.rules, current().round);

  const recallStep = (id: string, to: string): boolean => {
    const n = engine.reachable(current(), data, id)[to];
    return n !== undefined && n > 0 && n < budget();
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

  /** A move order to `to`, keeping the champion's pending ward, unward, Herald launch and stance. */
  const setMove = (id: string, to: string): void => {
    const prev = existingMove(id);
    const order: Order = { kind: 'move', champion: id, to };
    if (prev?.ward !== undefined) order.ward = prev.ward;
    if (prev?.unward !== undefined) order.unward = prev.unward;
    if (prev?.launchHerald) order.launchHerald = true;
    const stance = pending.value[id]?.stance;
    if (stance !== undefined) order.stance = stance;
    place(order);
  };

  const resolve = (): void => {
    const before = current();
    const orders = roundOrders;
    if (!orders) throw new Error('no round in progress');
    const full: ContactChoices = {};
    for (const c of contacts.value) {
      full[c.id] = { blue: choices.value[c.id]?.blue ?? playerDefault(c), red: redChoices[c.id]?.red ?? c.defaults.red };
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

    canAct(distance) {
      return engine.canAct(distance, budget());
    },

    wardRoundsLeft(ward) {
      return engine.wardRoundsLeft(ward, view.value?.round ?? current().round, data.rules);
    },

    doObjective(id) {
      setMove(id, champion(id).position);
      objectivePromptsClosed.value = [...objectivePromptsClosed.value, id];
    },

    otherOrder(id) {
      objectivePromptsClosed.value = [...objectivePromptsClosed.value, id];
      selected.value = id;
    },

    setMove,

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
        const step = recallStep(id, prev.to);
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

    stepBudget() {
      return budget();
    },

    routeOf(id, to) {
      const c = champion(id);
      return engine.route(data, c.position, to, c.side);
    },

    recallStep(id, to) {
      champion(id);
      return recallStep(id, to);
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
