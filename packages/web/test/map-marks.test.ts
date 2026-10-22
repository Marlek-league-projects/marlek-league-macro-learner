import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { createEngine } from '@lml/engine';
import type { PlayerView } from '@lml/engine/contracts';
import {
  dotRadius,
  hitRadius,
  objectivePromptEntries,
  rangeRing,
  spawnCountdown,
  WAVE_NEAR_TOWER,
  wavePoint,
} from '../src/components/map-marks';
import { createStore } from '../src/store';

const data = loadGameData();
const { positions } = data.graph;

function view(): PlayerView {
  const store = createStore(data, createEngine());
  store.start({ rank: 'gold', teaching: false, seed: 1 });
  store.confirmPlacement();
  return structuredClone(store.view.value!);
}

const toward = (a: string, b: string, t: number) => {
  const p = positions[a]!;
  const q = positions[b]!;
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
};

describe('spawnCountdown', () => {
  test('pit: seconds left before the next spawn, or up while the objective is there', () => {
    const v = view();
    v.pits['dragon-pit'] = { objective: null, nextSpawn: 300, capture: null };
    expect(spawnCountdown(v, data, 'dragon-pit', 220)).toBe(80);
    v.pits['dragon-pit'] = { objective: 'dragon', nextSpawn: null, capture: null };
    expect(spawnCountdown(v, data, 'dragon-pit', 220)).toBe('up');
  });

  test('pit with no spawn left shows nothing', () => {
    const v = view();
    v.pits['baron-pit'] = { objective: null, nextSpawn: null, capture: null };
    expect(spawnCountdown(v, data, 'baron-pit', 1400)).toBeNull();
  });

  test('scuttle: the timer the viewer knows', () => {
    const v = view();
    v.scuttles['scuttle-top'] = 400;
    v.scuttles['scuttle-bot'] = 100;
    expect(spawnCountdown(v, data, 'scuttle-top', 350)).toBe(50);
    expect(spawnCountdown(v, data, 'scuttle-bot', 350)).toBe('up');
  });

  test('own camp: respawn countdown or up; enemy camp unknown', () => {
    const v = view();
    v.camps = { 'krugs-blue': 500, 'gromp-blue': 90 };
    expect(spawnCountdown(v, data, 'krugs-blue', 420)).toBe(80);
    expect(spawnCountdown(v, data, 'gromp-blue', 420)).toBe('up');
    expect(spawnCountdown(v, data, 'krugs-red', 420)).toBeNull();
  });

  test('other positions have no timer', () => {
    expect(spawnCountdown(view(), data, 'mid-lane', 100)).toBeNull();
    expect(spawnCountdown(view(), data, 'top-t1-blue', 100)).toBeNull();
  });
});

describe('wavePoint', () => {
  test('a wave in the middle sits on the lane middle', () => {
    const v = view();
    v.waves.top = 0;
    const mid = positions['top-lane']!;
    expect(wavePoint(v, data, 'top')).toEqual({ x: mid.x, y: mid.y });
  });

  test('a wave near the blue tower sits by the blue front tower, toward the lane middle', () => {
    const v = view();
    v.waves.bot = -1;
    expect(wavePoint(v, data, 'bot')).toEqual(toward('bot-t1-blue', 'bot-lane', WAVE_NEAR_TOWER));
  });

  test('a wave near the red tower sits by the red front tower', () => {
    const v = view();
    v.waves.mid = 1;
    expect(wavePoint(v, data, 'mid')).toEqual(toward('mid-t1-red', 'mid-lane', WAVE_NEAR_TOWER));
  });

  test('a destroyed tower moves the front to the next tier', () => {
    const v = view();
    v.waves.mid = -1;
    v.towers['mid-t1-blue'] = 0;
    expect(wavePoint(v, data, 'mid')).toEqual(toward('mid-t2-blue', 'mid-lane', WAVE_NEAR_TOWER));
  });

  test('with every tower of the lane down, the wave sits by the base', () => {
    const v = view();
    v.waves.top = 1;
    for (const t of data.graph.towers('red', 'top')) v.towers[t] = 0;
    expect(wavePoint(v, data, 'top')).toEqual(toward('base-red', 'top-lane', WAVE_NEAR_TOWER));
  });

  test('wave positions stay between the two front towers of the lane', () => {
    const v = view();
    for (const lane of ['top', 'mid', 'bot'] as const) {
      const xs = ([-1, 0, 1] as const).map((w) => {
        v.waves[lane] = w;
        return wavePoint(v, data, lane);
      });
      const blue = positions[`${lane}-t1-blue`]!;
      const red = positions[`${lane}-t1-red`]!;
      const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
      expect(d(xs[0]!, blue)).toBeLessThan(d(xs[1]!, blue));
      expect(d(xs[1]!, blue)).toBeLessThan(d(xs[2]!, blue));
      expect(d(xs[2]!, red)).toBeLessThan(d(xs[1]!, red));
    }
  });
});

describe('click targets', () => {
  test('every position has a click circle about twice its dot', () => {
    for (const p of Object.values(positions)) {
      if (p.kind === 'base') continue;
      expect(hitRadius(p)).toBe(2 * dotRadius(p));
    }
  });

  test('pits are drawn larger than other positions', () => {
    expect(dotRadius(positions['dragon-pit']!)).toBeGreaterThan(dotRadius(positions['krugs-blue']!));
  });
});

describe('range rings', () => {
  const canAct = (d: number) => d < 2;
  test('in reach and able to act, arrival-only on the last step, nothing out of reach', () => {
    expect(rangeRing(0, canAct)).toBe('act');
    expect(rangeRing(1, canAct)).toBe('act');
    expect(rangeRing(2, canAct)).toBe('arrive');
    expect(rangeRing(undefined, canAct)).toBeNull();
  });
});

describe('enemy camp timers', () => {
  test('an enemy camp the view knows a timer for counts down like an own camp', () => {
    const v = view();
    v.camps = { ...v.camps, 'krugs-red': 500 };
    expect(spawnCountdown(v, data, 'krugs-red', 420)).toBe(80);
  });
});

const win = (start: number) => ({ start, end: start + 20 });

describe('objective prompt entries', () => {
  /** Opening view with the blue jungler on `position` and the pits' objectives set. */
  function onPit(position: string, dragon: 'dragon' | null, scuttleBotAt = 0) {
    const v = view();
    const j = v.allies.find((c) => c.role === 'jungle')!;
    j.position = position;
    v.pits['dragon-pit'] = { objective: dragon, nextSpawn: null, capture: null };
    v.scuttles['scuttle-bot'] = scuttleBotAt;
    return { v, j };
  }

  test('an own champion on a pit whose objective is up, with the Scuttle up too', () => {
    const { v, j } = onPit('dragon-pit', 'dragon', 100);
    expect(objectivePromptEntries(v, data, win(300), [])).toEqual([{ champion: j.id, pit: 'dragon-pit', objective: 'dragon', withScuttle: true }]);
    expect(objectivePromptEntries(v, data, win(50), [])[0]!.withScuttle).toBe(false);
  });

  test('an objective being taken still prompts', () => {
    const { v, j } = onPit('dragon-pit', 'dragon');
    v.pits['dragon-pit'].capture = { side: 'blue', startedRound: 3 };
    expect(objectivePromptEntries(v, data, win(300), []).map((e) => e.champion)).toEqual([j.id]);
  });

  test('none once answered, on an empty pit, on the Scuttle, or when dead', () => {
    const answered = onPit('dragon-pit', 'dragon');
    expect(objectivePromptEntries(answered.v, data, win(300), [answered.j.id])).toEqual([]);
    expect(objectivePromptEntries(onPit('dragon-pit', null).v, data, win(300), [])).toEqual([]);
    expect(objectivePromptEntries(onPit('scuttle-bot', 'dragon').v, data, win(300), [])).toEqual([]);
    const dead = onPit('dragon-pit', 'dragon');
    dead.j.status = 'dead';
    expect(objectivePromptEntries(dead.v, data, win(300), [])).toEqual([]);
  });
});
