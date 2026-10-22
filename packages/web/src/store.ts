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
  /** The blue jungler's start camp (a `-blue` camp id); undefined: Blue or Red Buff, picked by the seed. */
  junglerStart?: string;
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
  /**
   * Contacts the player answers; lane contacts resolved from stances (`auto`) are left out. Fog of war: each one's
   * `nearby.red` is emptied (where an enemy ends its move is its hidden order; its joiners show once it resolves).
   */
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
  /** Champions whose pending recall the last chosen destination replaced (it left no step for the recall). */
  recallReplaced: Signal<string[]>;
  start(s: Settings): void;
  /** Back to the start screen, dropping the current game. */
  reset(): void;
  select(id: string | null): void;
  reachableForSelected(): Record<string, number>;
  /** Steps `champion` may take this round (the base's extra steps included); arriving on the last one leaves no action. */
  stepBudget(champion: string): number;
  /** A position `distance` steps away lets `champion` act on arrival this round. */
  canAct(distance: number, champion: string): boolean;
  /** For an own champion with a pending move: whether it has a step left on arrival to act there; null without a move. */
  pendingMoveActs(champion: string): boolean | null;
  /** The path the engine walks for an own champion's move to `to`, both ends included. */
  routeOf(champion: string, to: string): string[];
  /** A move to `to` can come before a recall: it leaves a step of the budget for the recall. */
  recallStep(champion: string, to: string): boolean;
  /** Why `champion` cannot recall now (its pending move leaves no step for the recall), else null. */
  recallBlocked(champion: string): string | null;
  /** Rounds an own ward stays active, seen from the view's round (1 = its last active round). */
  wardRoundsLeft(ward: Ward): number;
  /** Stays on the pit to take its objective, and closes the champion's objective prompt. */
  doObjective(champion: string): void;
  /** Closes the champion's objective prompt and selects it for another order. */
  otherOrder(champion: string): void;
  /**
   * Moves to `to`. With a recall pending, keeps the recall (walking to `to` first) when `to` leaves a step for it;
   * otherwise replaces it with the move and lists the champion in `recallReplaced`.
   */
  setMove(champion: string, to: string): void;
  setWard(champion: string, spot: WardSpot | null): void;
  setUnward(champion: string, spot: 'from' | 'to' | null): void;
  /**
   * Recalls; after a pending move that leaves a step (`recallStep`) the champion walks there first (recall `to`). A
   * pending move leaving no step throws `recallBlocked`'s reason (the move is never dropped).
   */
  setRecall(champion: string): void;
  /** Sets the champion's lane stance on its order (the pending one, else its default order). */
  setStance(champion: string, stance: Stance): void;
  setSpawn(champion: string, to: string): void;
  clearOrder(champion: string): void;
  confirmRound(): void;
  choose(contactId: string, choice: Choice): void;
  /**
   * An own champion near a contact (`contact.nearby.blue`) joins it ("Rejoindre le combat") or stays (default). It
   * joins at most one contact: joining one leaves any other.
   */
  setJoin(contactId: string, champion: string, join: boolean): void;
  /** Own champions joining `contactId`. */
  joinsOf(contactId: string): string[];
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
  /** Where a respawning own champion may re-enter, nearest the base first. */
  spawnPointsFor(champion: string): string[];
  /** Where a respawning own champion re-enters with no spawn order: the engine's default spawn. */
  defaultSpawn(champion: string): string;
  /** Own alive champions that will do nothing this round: no pending order and a default of staying put (not wave followers). */
  championsWithoutOrder(): string[];
  /** True when the own champion, with no pending order, follows its lane wave by default. */
  followsWave(champion: string): boolean;
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

/** Camps the player's jungler may start on: the own (blue) jungle camps, in map order. */
export const junglerStartCamps = (data: GameData): string[] =>
  Object.values(data.graph.positions).filter((p) => p.kind === 'camp' && p.side === PLAYER).map((p) => p.id);
const ENEMY: Side = 'red';

/** A laner's home lane, as the engine's default orders see it (the jungler has none). */
const HOME_LANE: Record<string, string> = { top: 'top', mid: 'mid', adc: 'bot', support: 'bot' };

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
  const recallReplaced = signal<string[]>([]);

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

  const budget = (id: string): number => engine.stepBudgetFor(current(), data, id);

  const recallStep = (id: string, to: string): boolean => {
    const n = engine.reachable(current(), data, id)[to];
    return n !== undefined && n > 0 && n < budget(id);
  };

  /** The step budget minus the recall's own step, in words: "d'1 pas", "de 2 pas". */
  const stepsLeftForRecall = (id: string): string => {
    const n = budget(id) - 1;
    return n === 1 ? "d'1 pas" : `de ${n} pas`;
  };

  /** Why a recall cannot follow the pending order: a move that leaves no step. */
  const recallBlocked = (id: string): string | null => {
    const o = pending.value[id];
    if (o?.kind !== 'move' || o.to === champion(id).position || recallStep(id, o.to)) return null;
    return `Le recall demande un pas restant : déplacement ${stepsLeftForRecall(id)} au plus`;
  };

  const markReplaced = (id: string, replaced: boolean): void => {
    const rest = recallReplaced.value.filter((x) => x !== id);
    recallReplaced.value = replaced ? [...rest, id] : rest;
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

  /**
   * A move order to `to`, keeping the champion's pending ward, unward, Herald launch and stance. A pending recall
   * stays when `to` leaves a step for it (its own position: a recall in place), else the move replaces it.
   */
  const setMove = (id: string, to: string): void => {
    const pend = pending.value[id];
    if (pend?.kind === 'recall') {
      const here = to === champion(id).position;
      if (here || recallStep(id, to)) {
        const { to: _to, ...rest } = pend;
        const order: Extract<Order, { kind: 'recall' }> = here ? rest : { ...rest, to };
        // Without a step, the ward and the unward can only be on the start.
        if (here && order.ward === 'to') order.ward = 'from';
        if (here && order.unward === 'to') order.unward = 'from';
        place(order);
        markReplaced(id, false);
        return;
      }
    }
    const prev = existingMove(id) ?? (pend?.kind === 'recall' ? pend : null);
    const order: Order = { kind: 'move', champion: id, to };
    if (prev?.ward !== undefined) order.ward = prev.ward;
    if (prev?.unward !== undefined) order.unward = prev.unward;
    if (prev?.kind === 'move' && prev.launchHerald) order.launchHerald = true;
    const stance = pend?.stance;
    if (stance !== undefined) order.stance = stance;
    place(order);
    markReplaced(id, pend?.kind === 'recall');
  };

  const resolve = (): void => {
    const before = current();
    const orders = roundOrders;
    if (!orders) throw new Error('no round in progress');
    const full: ContactChoices = {};
    for (const c of contacts.value) {
      full[c.id] = {
        blue: choices.value[c.id]?.blue ?? playerDefault(c),
        red: redChoices[c.id]?.red ?? c.defaults.red,
        joins: { blue: choices.value[c.id]?.joins?.blue ?? [], red: redChoices[c.id]?.joins?.red ?? [] },
      };
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
    panelAt, panelDragging, objectivePromptsClosed, recallReplaced,

    start(s) {
      settings.value = s;
      profile = data.aiProfiles.find((p) => p.rank === s.rank) ?? null;
      if (!profile) throw new Error(`no AI profile for rank ${s.rank}`);
      state = engine.newGame(data, s.seed, undefined, s.junglerStart !== undefined ? { blueJunglerStart: s.junglerStart } : undefined);
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
      recallReplaced.value = [];
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
      recallReplaced.value = [];
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
      return c && c.status !== 'dead' ? engine.reachable(state, data, id) : {};
    },

    canAct(distance, id) {
      return engine.canAct(distance, budget(id));
    },

    pendingMoveActs(id) {
      const o = pending.value[id];
      if (o?.kind !== 'move' || !state) return null;
      const d = engine.reachable(state, data, id)[o.to];
      return d !== undefined && engine.canAct(d, budget(id));
    },

    wardRoundsLeft(ward) {
      return engine.wardRoundsLeft(ward, view.value?.round ?? current().round, data.rules);
    },

    doObjective(id) {
      // Keeps a pending move onto the pit (the prompt is also offered for one); otherwise stays where it stands. A
      // pending recall gives way (the prompt is not offered with one).
      if (pending.value[id]?.kind === 'recall') {
        const { [id]: _recall, ...rest } = pending.value;
        pending.value = rest;
      }
      setMove(id, existingMove(id)?.to ?? champion(id).position);
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
      const blocked = recallBlocked(id);
      if (blocked) throw new Error(blocked);
      const order: Extract<Order, { kind: 'recall' }> = { kind: 'recall', champion: id };
      if (prev?.kind === 'move') {
        const step = recallStep(id, prev.to);
        if (prev.ward === 'from' || (prev.ward === 'to' && step)) order.ward = prev.ward;
        if (prev.unward !== undefined && (step || prev.unward === 'from')) order.unward = prev.unward;
        if (step) order.to = prev.to;
      }
      if (prev?.stance !== undefined) order.stance = prev.stance;
      place(order);
      markReplaced(id, false);
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
      markReplaced(id, false);
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
      // The AI decides its joiners first (each joins at most one contact), then answers with them in the fight.
      redChoices = engine.aiAnswers(redView, data, involving, profile!, aiRng!);
      contacts.value = involving.map((c) => ({ ...c, nearby: { blue: c.nearby.blue, red: [] } }));
      choices.value = {};
      if (involving.length === 0) resolve();
      else screen.value = 'contacts';
    },

    choose(contactId, choice) {
      const c = contacts.value.find((x) => x.id === contactId);
      if (!c) throw new Error(`${contactId}: unknown contact`);
      if (!c.options.blue.includes(choice)) throw new Error(`${contactId}: ${choice} is not an option`);
      choices.value = { ...choices.value, [contactId]: { ...choices.value[contactId], blue: choice } };
    },

    setJoin(contactId, id, join) {
      const c = contacts.value.find((x) => x.id === contactId);
      if (!c) throw new Error(`${contactId}: unknown contact`);
      if (!c.nearby.blue.includes(id)) throw new Error(`${id}: cannot join ${contactId}`);
      const next: ContactChoices = {};
      for (const x of contacts.value) {
        const prev = choices.value[x.id];
        const rest = (prev?.joins?.blue ?? []).filter((j) => j !== id);
        const blue = join && x.id === contactId ? [...rest, id].sort() : rest;
        if (prev || blue.length > 0) next[x.id] = { ...prev, joins: { blue } };
      }
      choices.value = next;
    },

    joinsOf(contactId) {
      return choices.value[contactId]?.joins?.blue ?? [];
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
      recallReplaced.value = [];
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

    stepBudget(id) {
      return budget(id);
    },

    routeOf(id, to) {
      const c = champion(id);
      return engine.route(data, c.status === 'respawning' ? `base-${c.side}` : c.position, to, c.side);
    },

    recallStep(id, to) {
      champion(id);
      return recallStep(id, to);
    },

    recallBlocked(id) {
      return recallBlocked(id);
    },

    spawnPointsFor(id) {
      champion(id);
      return engine.spawnPoints(current(), data, id);
    },

    defaultSpawn(id) {
      champion(id);
      const def = engine.defaultOrders(current(), data, PLAYER).find((o) => o.champion === id);
      if (def?.kind !== 'spawn') throw new Error(`${id}: not respawning`);
      return def.to;
    },

    followsWave(id) {
      const c = champion(id);
      const lane = HOME_LANE[c.role];
      return c.status === 'alive' && lane !== undefined && data.graph.positions[c.position]?.lane === lane;
    },

    championsWithoutOrder() {
      const pend = pending.value;
      return current().champions.flatMap((c) => {
        if (c.side !== PLAYER || c.status !== 'alive' || pend[c.id]) return [];
        const lane = HOME_LANE[c.role];
        if (lane !== undefined && data.graph.positions[c.position]?.lane === lane) return [];
        const def = engine.defaultOrders(current(), data, PLAYER).find((o) => o.champion === c.id);
        return def?.kind === 'move' && def.to === c.position ? [c.id] : [];
      });
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
