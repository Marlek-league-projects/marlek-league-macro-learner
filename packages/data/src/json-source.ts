import type { GameDataSource } from './contracts';
import { loadGameData } from './load';

export const jsonGameDataSource: GameDataSource = { load: loadGameData };
