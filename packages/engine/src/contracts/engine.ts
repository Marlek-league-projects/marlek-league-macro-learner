import type { AiProfile, GameData, Role, Rules, Side, Stage } from '@lml/data/contracts';
import type { Choice, Contact, ContactChoices } from './contacts';
import type { GameEvent } from './events';
import type { Order, Orders } from './orders';
import type { GameState, Rng, Ward } from './state';
import type { Explanation } from './teaching';
import type { EnemyEstimate, EnemyInfo, PlayerView } from './view';

export type Draft = Record<Side, Record<Role, string>>;

/** Time window covered by one round. */
export interface RoundWindow {
  start: number;
  end: number;
  phase: number;
  stage: Stage;
  seconds: number;
}

export interface RoundResult {
  state: GameState;
  events: GameEvent[];
}

/** The engine surface the web app uses. */
export interface GameEngine {
  newGame(data: GameData, seed: number, draft?: Draft): GameState;
  defaultOrders(state: GameState, data: GameData, side: Side): Order[];
  reachable(state: GameState, data: GameData, championId: string): Record<string, number>;
  /** True when a step between two positions changes lane (which ends the move). */
  isLaneChange(data: GameData, from: string, to: string): boolean;
  /** Deterministic shortest path a `side` champion walks, both ends included (lane position, else camp, else river). */
  route(data: GameData, from: string, to: string, side: Side): string[];
  /** Steps every champion may take in `round`; arriving on the last one leaves no action. */
  stepBudget(rules: Rules, round: number): number;
  /** A champion `distance` steps away acts on arrival (staying acts). */
  canAct(distance: number, budget: number): boolean;
  spawnPoints(state: GameState, data: GameData, championId: string): string[];
  validateOrders(state: GameState, data: GameData, side: Side, orders: Order[]): void;
  detectContacts(state: GameState, data: GameData, orders: Orders): Contact[];
  resolveRound(state: GameState, data: GameData, orders: Orders, choices: ContactChoices): RoundResult;
  viewFor(state: GameState, data: GameData, side: Side): PlayerView;
  /** What `view.side` assumes `enemy` has (xp, items, lead), from what it knows; the AI uses the same estimate. */
  estimateEnemy(view: PlayerView, data: GameData, enemy: EnemyInfo): EnemyEstimate;
  eventsFor(events: GameEvent[], after: GameState, data: GameData, side: Side): GameEvent[];
  /** Rounds of vision a ward has left seen from `round`, that round included (`wards.duration` down to 1, 0 once spent). */
  wardRoundsLeft(ward: Ward, round: number, rules: Rules): number;
  /** AI orders from what its side sees (a view, never the state). */
  aiOrders(view: PlayerView, data: GameData, profile: AiProfile, rng: Rng): Order[];
  aiContactChoice(view: PlayerView, data: GameData, contact: Contact, profile: AiProfile, rng: Rng): Choice;
  /** Tempo lessons for `side` from the round `before` → `after`, using only what `side` saw. */
  explainRound(before: GameState, after: GameState, events: GameEvent[], data: GameData, side: Side): Explanation[];
  createRng(seed: number): Rng;
  roundWindow(rules: Rules, round: number): RoundWindow;
  totalRounds(rules: Rules): number;
  level(xp: number, rules: Rules): number;
  teamScore(state: GameState, data: GameData, side: Side): number;
}
