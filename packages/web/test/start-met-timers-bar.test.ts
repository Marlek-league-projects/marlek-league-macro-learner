import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { createEngine } from '@lml/engine';
import type { EnemyInfo, PlayerView, Scoreboard } from '@lml/engine/contracts';
import { enemySeenText, eventText, objectiveWithArticle } from '../src/components/format';
import { metHud, powerOf } from '../src/components/hud';
import { pitTimer } from '../src/components/map-marks';
import { goldShort, scoreBarSides } from '../src/components/score-bar';
import { createStore, junglerStartCamps } from '../src/store';

const data = loadGameData();

function started(junglerStart?: string, seed = 1) {
  const store = createStore(data, createEngine());
  store.start({ rank: 'gold', teaching: false, seed, ...(junglerStart ? { junglerStart } : {}) });
  return store;
}

const view = (): PlayerView => structuredClone(started().view.value!);

describe('jungler start choice', () => {
  test('the six own camps are offered', () => {
    const camps = junglerStartCamps(data);
    expect(camps).toHaveLength(6);
    expect(camps.every((id) => id.endsWith('-blue') && data.graph.positions[id]!.kind === 'camp')).toBe(true);
    expect(camps).toContain('gromp-blue');
    expect(camps).toContain('bluebuff-blue');
  });

  test('the chosen camp is where the blue jungler starts, and it is remembered in the settings', () => {
    for (const camp of junglerStartCamps(data)) {
      const store = started(camp);
      expect(store.view.value!.allies.find((c) => c.role === 'jungle')!.position).toBe(camp);
      expect(store.settings.value.junglerStart).toBe(camp);
    }
  });

  test('no choice: the seed picks Blue or Red Buff, as before', () => {
    const jungle = started().view.value!.allies.find((c) => c.role === 'jungle')!;
    expect(['bluebuff-blue', 'redbuff-blue']).toContain(jungle.position);
  });
});

describe('met enemy card', () => {
  const enemy = (over: Partial<EnemyInfo>): EnemyInfo => ({
    id: 'X', role: 'mid', visible: false, position: 'mid-lane', lastSeenRound: 3, level: null, hp: null, met: null, ...over,
  });

  test('a met enemy says where and when it was crossed', () => {
    const e = enemy({ met: { round: 5, position: 'raptors-blue', level: 4, hp: 60 } });
    expect(enemySeenText(data, e)).toBe(`Croisé : ${data.graph.positions['raptors-blue']!.label} (round 5)`);
  });

  test('visible beats met; without met the last sighting stays', () => {
    expect(enemySeenText(data, enemy({ visible: true, level: 3, hp: 90 }))).toMatch(/^Vue : .* \(ce round\)$/);
    expect(enemySeenText(data, enemy({}))).toMatch(/^Dernière vue : .* \(round 3\)$/);
    expect(enemySeenText(data, enemy({ position: null, lastSeenRound: null }))).toBe('Jamais vu');
  });

  test('its card shows the level and HP it had then, and the power estimated from them', () => {
    const store = started();
    const e = { ...store.view.value!.enemies[0]!, visible: false, level: null, hp: null, met: { round: 2, position: 'mid-lane', level: 3, hp: 40 } };
    const h = metHud(e, data, store.estimateEnemy)!;
    expect(h.level).toBe(3);
    expect(h.hp).toBeCloseTo(40 / data.rules.health.max);
    expect(h.xp).toBeNull();
    const est = store.estimateEnemy({ ...e, level: 3, hp: 40 });
    expect(h.power).toBe(powerOf(est.xp + est.items + est.bonusLead));
    expect(metHud({ ...e, met: null }, data, store.estimateEnemy)).toBeNull();
  });
});

describe('pit timer', () => {
  test('the Baron pit names what it counts down to, with the time left', () => {
    const v = view();
    v.pits['baron-pit'] = { objective: null, nextSpawn: 480, capture: null };
    expect(pitTimer(v, data, 'baron-pit', 55)).toMatchObject({ text: 'Larves 7:05', live: false, until: null });
    expect(pitTimer(v, data, 'baron-pit', 55)!.title).toBe('Larves à 8:00 (dans 7:05)');
    v.pits['baron-pit'] = { objective: null, nextSpawn: 900, capture: null };
    expect(pitTimer(v, data, 'baron-pit', 600)!.text).toBe('Héraut 5:00');
    v.pits['baron-pit'] = { objective: null, nextSpawn: 1200, capture: null };
    expect(pitTimer(v, data, 'baron-pit', 900)!.text).toBe('Nashor 5:00');
  });

  test('while the grubs are up it shows the time left before they despawn', () => {
    const v = view();
    v.pits['baron-pit'] = { objective: 'voidgrubs', nextSpawn: null, capture: null };
    expect(pitTimer(v, data, 'baron-pit', 400)).toMatchObject({ text: 'Larves en vie', live: true, until: 'part dans 8:05' });
  });

  test('the dragon pit: "Dragon m:ss" (time left), and no despawn while up; nothing to come shows nothing', () => {
    const v = view();
    v.pits['dragon-pit'] = { objective: null, nextSpawn: 300, capture: null };
    expect(pitTimer(v, data, 'dragon-pit', 55)!.text).toBe('Dragon 4:05');
    v.pits['dragon-pit'] = { objective: 'dragon', nextSpawn: null, capture: null };
    expect(pitTimer(v, data, 'dragon-pit', 400)).toMatchObject({ text: 'Dragon en vie', live: true, until: null });
    v.pits['baron-pit'] = { objective: null, nextSpawn: null, capture: null };
    expect(pitTimer(v, data, 'baron-pit', 1400)).toBeNull();
  });
});

describe('objective log lines', () => {
  test('taken objectives come with their article', () => {
    const taken = (objective: 'voidgrubs' | 'herald' | 'baron' | 'dragon' | 'scuttle', position: string) =>
      eventText({ type: 'objectiveTaken', objective, side: 'red', position, champions: [] }, data);
    const baron = data.graph.positions['baron-pit']!.label;
    expect(taken('voidgrubs', 'baron-pit')).toBe(`Rouge prend les Larves à ${baron}`);
    expect(taken('herald', 'baron-pit')).toBe(`Rouge prend le Héraut à ${baron}`);
    expect(taken('baron', 'baron-pit')).toBe(`Rouge prend le Nashor à ${baron}`);
    expect(taken('dragon', 'dragon-pit')).toBe(`Rouge prend le Dragon à ${data.graph.positions['dragon-pit']!.label}`);
    expect(objectiveWithArticle('scuttle')).toBe('le Carapateur');
  });
});

describe('score bar', () => {
  const board = (): Scoreboard => ({
    kills: { blue: 4, red: 2 },
    towersDestroyed: { blue: 1, red: 0 },
    dragons: { blue: 0, red: 2 },
    barons: { blue: 0, red: 0 },
    heralds: { blue: 1, red: 0 },
    voidgrubs: { blue: 0, red: 1 },
    plates: { blue: 3, red: 1 },
    goldEarned: { blue: 12_340, red: 11_100 },
  });

  test('per team: kills, gold, the lead on the side ahead, and towers to barons in order', () => {
    const { blue, red } = scoreBarSides(board());
    expect(blue).toMatchObject({ side: 'blue', kills: 4, gold: '12,3k', lead: '+1,2k' });
    expect(red).toMatchObject({ side: 'red', kills: 2, gold: '11,1k', lead: null });
    expect(blue.stats.map((s) => [s.label, s.value])).toEqual([
      ['Tours', 1], ['Plaques', 3], ['Larves', 0], ['Hérauts', 1], ['Dragons', 0], ['Nashor', 0],
    ]);
    expect(red.stats.map((s) => s.value)).toEqual([0, 1, 1, 0, 2, 0]);
  });

  test('red ahead gets the lead; a tie shows none', () => {
    const b = board();
    b.goldEarned = { blue: 500, red: 900 };
    expect(scoreBarSides(b).red.lead).toBe('+400');
    expect(scoreBarSides(b).blue.lead).toBeNull();
    b.goldEarned = { blue: 900, red: 900 };
    expect(scoreBarSides(b).blue.lead).toBeNull();
    expect(scoreBarSides(b).red.lead).toBeNull();
  });

  test('gold is short like a broadcast', () => {
    expect(goldShort(850)).toBe('850');
    expect(goldShort(12_349)).toBe('12,3k');
    expect(goldShort(1000)).toBe('1,0k');
  });

  test('the view gives the bar every field', () => {
    const s = view().scoreboard;
    for (const k of ['kills', 'towersDestroyed', 'dragons', 'barons', 'heralds', 'voidgrubs', 'plates', 'goldEarned'] as const) {
      expect(typeof s[k].blue).toBe('number');
      expect(typeof s[k].red).toBe('number');
    }
  });
});
