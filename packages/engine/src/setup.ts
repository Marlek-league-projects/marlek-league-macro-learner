import type { GameData, Role, Side } from '@lml/data/contracts';
import type { ChampionState, Draft, GameState, PitState, Rng } from './contracts';
import { laneStart } from './placement';
import { createRng } from './rng';

const SIDES: Side[] = ['blue', 'red'];
const ROLES: Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];
const JUNGLE_START_CAMPS = ['bluebuff', 'redbuff'];

/** Draws 10 distinct roster champions, one per side and role. */
export function randomDraft(data: GameData, rng: Rng): Draft {
  const used = new Set<string>();
  const draft = { blue: {}, red: {} } as Draft;
  for (const side of SIDES) {
    for (const role of ROLES) {
      const pool = data.roster.filter((id) => !used.has(id) && data.champions[id]?.roles?.includes(role));
      const id = rng.pick(pool);
      used.add(id);
      draft[side][role] = id;
    }
  }
  return draft;
}

/**
 * The game before round 0's placement: laners on their own T1, each jungler on a seeded buff (the default start, see
 * placeChampions). No camp is cleared: every camp first spawns at its `firstSpawnByCamp` (round 1, from 0:55).
 */
export function newGame(data: GameData, seed: number, draft?: Draft): GameState {
  const { rules, graph } = data;
  const rng = createRng(seed);
  const picks = draft ?? randomDraft(data, rng);

  const champions: ChampionState[] = [];
  for (const side of SIDES) {
    for (const role of ROLES) {
      const position = role === 'jungle' ? `${rng.pick(JUNGLE_START_CAMPS)}-${side}` : laneStart(side, role);
      champions.push({
        id: picks[side][role], side, role, position, previous: position,
        status: 'alive', respawnRound: null, xp: 0, gold: 0, items: 0, bonusLead: 0, goldEarned: 0, hasHerald: false,
        stance: 'farm', hp: rules.health.max,
      });
    }
  }

  const towers: Record<string, number> = {};
  const camps: Record<string, number> = {};
  for (const p of Object.values(graph.positions)) {
    if (p.kind === 'tower') towers[p.id] = rules.towers.hp;
    else if (p.kind === 'camp') camps[p.id] = rules.camps.firstSpawnByCamp[p.camp!];
  }

  const scuttleSpawn = rules.objectives.scuttle.firstSpawn;
  const pit = (spawn: number): PitState => ({ objective: null, nextSpawn: spawn, capture: null });

  // Each side sees the enemy jungler's start in round 1 (placeChampions moves the sighting with it).
  const lastSeen: GameState['lastSeen'] = { blue: {}, red: {} };
  for (const side of SIDES) {
    for (const enemy of champions.filter((c) => c.side !== side)) {
      lastSeen[side][enemy.id] =
        enemy.role === 'jungle' ? { position: enemy.position, round: 0 } : null;
    }
  }

  return {
    seed,
    rngState: rng.state(),
    round: 1,
    over: false,
    champions,
    towers,
    waves: { top: 0, mid: 0, bot: 0 },
    camps,
    scuttles: { 'scuttle-top': scuttleSpawn, 'scuttle-bot': scuttleSpawn },
    scuttlesSeen: {
      blue: { 'scuttle-top': scuttleSpawn, 'scuttle-bot': scuttleSpawn },
      red: { 'scuttle-top': scuttleSpawn, 'scuttle-bot': scuttleSpawn },
    },
    campsSeen: { blue: { ...camps }, red: { ...camps } },
    pits: {
      'baron-pit': pit(rules.objectives.voidgrubs.firstSpawn),
      'dragon-pit': pit(rules.objectives.dragon.firstSpawn),
    },
    wards: [],
    grubs: { blue: false, red: false },
    baronUntilRound: { blue: 0, red: 0 },
    objectivesTaken: { blue: {}, red: {} },
    platesTaken: { blue: 0, red: 0 },
    towersDestroyed: { blue: 0, red: 0 },
    kills: { blue: 0, red: 0 },
    lastSeen,
    met: { blue: {}, red: {} },
    winner: null,
  };
}
