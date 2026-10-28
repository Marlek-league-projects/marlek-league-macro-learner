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
  /** The game before round 0's placement: laners on their own T1, each jungler on a seeded buff, no camp cleared. */
  newGame(data: GameData, seed: number, draft?: Draft): GameState;
  /** Round 0: the positions a `side` champion may start on (own towers, camps, base; the lane middles), in map order. */
  placementPositions(data: GameData, side: Side): string[];
  /**
   * Round 0 (before round 1 resolves): `side`'s champions to their start positions (champion id → position id; several
   * may share one). Only positions change, nothing resolves; throws on another side's champion or a position not allowed.
   */
  placeChampions(state: GameState, data: GameData, side: Side, placements: Record<string, string>): GameState;
  /** The AI's round 0 placement from its view: laners on their own T1, the jungler on its seeded buff. */
  aiPlacements(view: PlayerView, data: GameData): Record<string, string>;
  defaultOrders(state: GameState, data: GameData, side: Side): Order[];
  /** True when the champion is an alive laner in its home lane, so its default order follows the wave. */
  followsWave(state: GameState, data: GameData, championId: string): boolean;
  reachable(state: GameState, data: GameData, championId: string): Record<string, number>;
  /** True when a step between two positions changes lane (which ends the move). */
  isLaneChange(data: GameData, from: string, to: string): boolean;
  /** Deterministic shortest path a `side` champion walks, both ends included (lane position, else camp, else river). */
  route(data: GameData, from: string, to: string, side: Side): string[];
  /** Steps every champion may take in `round`; arriving on the last one leaves no action. */
  stepBudget(rules: Rules, round: number): number;
  /** A champion's steps this round: `stepBudget`, plus `moves.baseBonus` when its move starts on its base (respawns too). */
  stepBudgetFor(state: GameState, data: GameData, championId: string): number;
  /** A champion `distance` steps away acts on arrival (staying acts). */
  canAct(distance: number, budget: number): boolean;
  spawnPoints(state: GameState, data: GameData, championId: string): string[];
  validateOrders(state: GameState, data: GameData, side: Side, orders: Order[]): void;
  detectContacts(state: GameState, data: GameData, orders: Orders): Contact[];
  /**
   * Where a champion of `contact` may flee (its `fleeTo`; `state`: the round's input state, as for `detectContacts`):
   * the automatic step toward its base first (when it has one; without a pick it takes it, or stays), then the other
   * neighbours of where it steps from, minus the contact's positions, the enemy base and those strictly closer to the
   * enemy base than where it steps from.
   */
  fleeSteps(state: GameState, data: GameData, contact: Contact, championId: string): string[];
  resolveRound(state: GameState, data: GameData, orders: Orders, choices: ContactChoices): RoundResult;
  viewFor(state: GameState, data: GameData, side: Side): PlayerView;
  /** What `view.side` assumes `enemy` has (xp, items, lead), from what it knows; the AI uses the same estimate. */
  estimateEnemy(view: PlayerView, data: GameData, enemy: EnemyInfo): EnemyEstimate;
  eventsFor(events: GameEvent[], after: GameState, data: GameData, side: Side): GameEvent[];
  /** Rounds of vision a ward has left seen from `round`, that round included (`wards.duration` down to 1, 0 once spent). */
  wardRoundsLeft(ward: Ward, round: number, rules: Rules): number;
  /** AI orders from what its side sees (a view, never the state). */
  aiOrders(view: PlayerView, data: GameData, profile: AiProfile, rng: Rng): Order[];
  /** `joins`: the side's own champions joining the contact (from `aiJoins`), counted in its fight estimate. */
  aiContactChoice(view: PlayerView, data: GameData, contact: Contact, profile: AiProfile, rng: Rng, joins?: string[]): Choice;
  /**
   * The AI's champions joining a prompted contact from 1 step away (of `contact.nearby[view.side]`, minus `taken`):
   * those that turn a lost or tied fight into a won one, inverted on a `joinFight` mistake roll.
   */
  aiJoins(view: PlayerView, data: GameData, contact: Contact, profile: AiProfile, rng: Rng, taken?: ReadonlySet<string>): string[];
  /** `view.side`'s answers (choice and joiners) to a round's contacts, in id order: `aiJoins` then `aiContactChoice` per contact. */
  aiAnswers(view: PlayerView, data: GameData, contacts: Contact[], profile: AiProfile, rng: Rng): ContactChoices;
  /** Tempo lessons for `side` from the round `before` → `after`, using only what `side` saw. */
  explainRound(before: GameState, after: GameState, events: GameEvent[], data: GameData, side: Side): Explanation[];
  createRng(seed: number): Rng;
  roundWindow(rules: Rules, round: number): RoundWindow;
  totalRounds(rules: Rules): number;
  level(xp: number, rules: Rules): number;
  teamScore(state: GameState, data: GameData, side: Side): number;
}
