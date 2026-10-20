import type { AiProfile, GameData, Role, Side } from '@lml/data/contracts';
import type { Choice, Contact, ContactChoices } from './contacts';
import type { GameEvent } from './events';
import type { Order, Orders } from './orders';
import type { GameState, Rng } from './state';
import type { PlayerView } from './view';

export type Draft = Record<Side, Record<Role, string>>;

export interface RoundResult {
  state: GameState;
  events: GameEvent[];
}

/** The engine surface the web app uses. */
export interface GameEngine {
  newGame(data: GameData, seed: number, draft?: Draft): GameState;
  defaultOrders(state: GameState, data: GameData, side: Side): Order[];
  reachable(state: GameState, data: GameData, championId: string): Record<string, number>;
  spawnPoints(state: GameState, data: GameData, championId: string): string[];
  validateOrders(state: GameState, data: GameData, side: Side, orders: Order[]): void;
  detectContacts(state: GameState, data: GameData, orders: Orders): Contact[];
  resolveRound(state: GameState, data: GameData, orders: Orders, choices: ContactChoices): RoundResult;
  viewFor(state: GameState, data: GameData, side: Side): PlayerView;
  eventsFor(events: GameEvent[], after: GameState, data: GameData, side: Side): GameEvent[];
  /** AI orders from what its side sees (a view, never the state). */
  aiOrders(view: PlayerView, data: GameData, profile: AiProfile, rng: Rng): Order[];
  aiContactChoice(view: PlayerView, data: GameData, contact: Contact, profile: AiProfile, rng: Rng): Choice;
  /** Added by Task 13. */
  explainRound?: unknown;
}
