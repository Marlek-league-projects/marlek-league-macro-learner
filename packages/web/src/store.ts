import { signal, type Signal } from '@preact/signals';
import type { AiProfile, GameData, Rank, Side } from '@lml/data/contracts';
import type {
  Choice,
  Contact,
  ContactChoices,
  Explanation,
  GameEngine,
  GameEvent,
  GameState,
  Order,
  Orders,
  PlayerView,
  Rng,
  WardSpot,
} from '@lml/engine/contracts';

export type Screen = 'start' | 'orders' | 'contacts' | 'review' | 'over';

export interface Settings {
  rank: Rank;
  teaching: boolean;
  seed: number;
}

export interface Store {
  screen: Signal<Screen>;
  view: Signal<PlayerView | null>;
  selected: Signal<string | null>;
  pending: Signal<Record<string, Order>>;
  contacts: Signal<Contact[]>;
  choices: Signal<ContactChoices>;
  lastEvents: Signal<GameEvent[]>;
  explanations: Signal<Explanation[]>;
  settings: Signal<Settings>;
  start(s: Settings): void;
  select(id: string | null): void;
  reachableForSelected(): Record<string, number>;
  setMove(champion: string, to: string): void;
  setWard(champion: string, spot: WardSpot | null): void;
  setUnward(champion: string, spot: 'from' | 'to' | null): void;
  setRecall(champion: string): void;
  setSpawn(champion: string, to: string): void;
  clearOrder(champion: string): void;
  confirmRound(): void;
  choose(contactId: string, choice: Choice): void;
  confirmContacts(): void;
  next(): void;
}

const PLAYER: Side = 'blue';
const ENEMY: Side = 'red';

export function createStore(data: GameData, engine: GameEngine): Store {
  const screen = signal<Screen>('start');
  const view = signal<PlayerView | null>(null);
  const selected = signal<string | null>(null);
  const pending = signal<Record<string, Order>>({});
  const contacts = signal<Contact[]>([]);
  const choices = signal<ContactChoices>({});
  const lastEvents = signal<GameEvent[]>([]);
  const explanations = signal<Explanation[]>([]);
  const settings = signal<Settings>({ rank: 'gold', teaching: true, seed: 1 });

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

  const campAlive = (id: string): boolean => {
    const s = current();
    return (s.camps[id] ?? 0) <= engine.roundWindow(data.rules, s.round).start;
  };

  /** First intermediate step of a shortest path to a 2-step target; fast clearers prefer an alive own camp. */
  const viaFor = (id: string, to: string): string | undefined => {
    const c = champion(id);
    const { graph, rules } = data;
    if (graph.distance(c.position, to) !== 2) return undefined;
    const mids = (graph.adj[c.position] ?? []).filter((n) => n !== `base-${ENEMY}` && graph.distance(n, to) === 1);
    const fast = c.role === 'jungle' && (data.champions[id]?.clearSpeed ?? 0) >= rules.camps.fastClearAt;
    if (fast) {
      const camp = mids.find((n) => {
        const p = graph.positions[n];
        return p?.kind === 'camp' && p.side === PLAYER && campAlive(n);
      });
      if (camp) return camp;
    }
    return mids[0];
  };

  const existingMove = (id: string): Extract<Order, { kind: 'move' }> | null => {
    const o = pending.value[id];
    return o?.kind === 'move' ? o : null;
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
    explanations.value = settings.value.teaching
      ? engine.explainRound(before, result.state, result.events, data, PLAYER)
      : [];
    publish();
    screen.value = result.state.over ? 'over' : 'review';
  };

  return {
    screen, view, selected, pending, contacts, choices, lastEvents, explanations, settings,

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
      publish();
      screen.value = 'orders';
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

    setMove(id, to) {
      const prev = existingMove(id);
      const via = viaFor(id, to);
      const order: Order = { kind: 'move', champion: id, to };
      if (via !== undefined) order.via = via;
      if (prev?.ward !== undefined) order.ward = prev.ward;
      if (prev?.unward !== undefined) order.unward = prev.unward;
      if (prev?.launchHerald) order.launchHerald = true;
      place(order);
    },

    setWard(id, spot) {
      const prev = pending.value[id];
      if (prev?.kind === 'recall') {
        if (spot !== null && spot !== 'from') throw new Error(`${id}: a recall can only ward its own position`);
        const { ward: _drop, ...rest } = prev;
        place(spot === null ? rest : { ...rest, ward: 'from' });
        return;
      }
      const base: Extract<Order, { kind: 'move' }> =
        prev?.kind === 'move' ? { ...prev } : { kind: 'move', champion: id, to: champion(id).position };
      delete base.ward;
      if (spot !== null) base.ward = spot;
      place(base);
    },

    setUnward(id, spot) {
      const prev = pending.value[id];
      const base: Extract<Order, { kind: 'move' }> =
        prev?.kind === 'move' ? { ...prev } : { kind: 'move', champion: id, to: champion(id).position };
      delete base.unward;
      if (spot !== null) base.unward = spot;
      place(base);
    },

    setRecall(id) {
      const prev = pending.value[id];
      const order: Order = { kind: 'recall', champion: id };
      if (prev?.kind === 'move' && prev.ward === 'from') order.ward = 'from';
      place(order);
    },

    setSpawn(id, to) {
      place({ kind: 'spawn', champion: id, to });
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
      const red = engine.aiOrders(engine.viewFor(s, data, ENEMY), data, profile!, aiRng!);
      roundOrders = { blue, red };
      const involving = engine.detectContacts(s, data, roundOrders).filter((c) => c.blue.length > 0);
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
      resolve();
    },

    next() {
      if (screen.value !== 'review') return;
      pending.value = {};
      selected.value = null;
      contacts.value = [];
      choices.value = {};
      screen.value = 'orders';
    },
  };
}
