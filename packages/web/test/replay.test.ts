import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { createEngine } from '@lml/engine';
import type { GameEvent, PlayerView } from '@lml/engine/contracts';
import { buildReplay, parseReplayAt, stepWindow, tokensAt } from '../src/replay';
import { createStore } from '../src/store';

const data = loadGameData();

/** The opening view (seed 1): Fiora top-t1-blue, LeeSin bluebuff-blue, Kindred visible on bluebuff-red, Garen hidden. */
function opening(): PlayerView {
  const store = createStore(data, createEngine());
  store.start({ rank: 'gold', teaching: false, seed: 1 });
  return structuredClone(store.view.value!);
}

function moved(v: PlayerView, id: string, to: string): PlayerView {
  const next = structuredClone(v);
  const ally = next.allies.find((c) => c.id === id);
  if (ally) ally.position = to;
  const enemy = next.enemies.find((e) => e.id === id);
  if (enemy) enemy.position = to;
  return next;
}

describe('buildReplay', () => {
  test('the ally moves from the round events become move steps', () => {
    const before = opening();
    const after = moved(moved(before, 'Fiora', 'top-lane'), 'LeeSin', 'gromp-blue');
    const events: GameEvent[] = [
      { type: 'moved', champion: 'Fiora', from: 'top-t1-blue', to: 'top-lane', acted: true },
      { type: 'moved', champion: 'LeeSin', from: 'bluebuff-blue', to: 'gromp-blue', acted: true },
    ];
    expect(buildReplay(before, after, events)).toEqual([
      { kind: 'move', champion: 'Fiora', from: 'top-t1-blue', to: 'top-lane' },
      { kind: 'move', champion: 'LeeSin', from: 'bluebuff-blue', to: 'gromp-blue' },
    ]);
  });

  test('an enemy moved event absent from the filtered events never appears', () => {
    const before = opening();
    // Garen walked top-t1-red → top-lane unseen: eventsFor dropped the event and he stays hidden.
    const after = structuredClone(before);
    const steps = buildReplay(before, after, []);
    expect(steps.some((s) => s.kind === 'move' && s.champion === 'Garen')).toBe(false);
    expect(tokensAt(before, steps, 0.5).some((t) => t.champion === 'Garen')).toBe(false);
  });

  test('an enemy move is kept only while the enemy is visible before or after it', () => {
    const before = opening();
    const after = moved(before, 'Kindred', 'gromp-red');
    const events: GameEvent[] = [
      { type: 'moved', champion: 'Kindred', from: 'bluebuff-red', to: 'gromp-red', acted: true },
      { type: 'moved', champion: 'Garen', from: 'top-t1-red', to: 'top-lane', acted: true },
    ];
    expect(buildReplay(before, after, events)).toEqual([
      { kind: 'move', champion: 'Kindred', from: 'bluebuff-red', to: 'gromp-red' },
    ]);
  });

  test('a fight produces a fight step at its position before the death steps', () => {
    const before = opening();
    const after = moved(before, 'Fiora', 'top-lane');
    after.allies.find((c) => c.id === 'Fiora')!.status = 'dead';
    const events: GameEvent[] = [
      { type: 'moved', champion: 'Fiora', from: 'top-t1-blue', to: 'top-lane', acted: true },
      { type: 'death', champion: 'Fiora', position: 'top-lane', respawnRound: 4 },
      { type: 'fight', position: 'top-lane', blue: ['Fiora'], red: ['Garen'], winner: 'red', scores: { blue: 1, red: 2 } },
    ];
    const steps = buildReplay(before, after, events);
    const kinds = steps.map((s) => s.kind);
    expect(kinds).toEqual(['move', 'fight', 'death']);
    expect(steps[1]).toMatchObject({ kind: 'fight', position: 'top-lane' });
    expect(steps[2]).toMatchObject({ kind: 'death', position: 'top-lane', champion: 'Fiora' });
  });

  test('a recall in place is a recall step where the token stands, with no slide', () => {
    const before = opening();
    const after = structuredClone(before);
    const fiora = after.allies.find((c) => c.id === 'Fiora')!;
    fiora.status = 'respawning';
    fiora.position = 'base-blue';
    const steps = buildReplay(before, after, [{ type: 'recall', champion: 'Fiora', itemsBought: 1200 }]);
    expect(steps).toEqual([{ kind: 'recall', champion: 'Fiora', position: 'top-t1-blue' }]);
  });

  test('a recall after a step recalls at the end of the move; the catch-up never slides it on', () => {
    const before = opening();
    const after = structuredClone(before);
    const fiora = after.allies.find((c) => c.id === 'Fiora')!;
    fiora.status = 'respawning';
    fiora.position = 'base-blue';
    const steps = buildReplay(before, after, [
      { type: 'moved', champion: 'Fiora', from: 'top-t1-blue', to: 'top-lane', acted: true },
      { type: 'recall', champion: 'Fiora', itemsBought: 1200 },
    ]);
    expect(steps).toEqual([
      { kind: 'move', champion: 'Fiora', from: 'top-t1-blue', to: 'top-lane' },
      { kind: 'recall', champion: 'Fiora', position: 'top-lane' },
    ]);
  });

  test('a recalled enemy seen before is not slid to where the after view last saw it', () => {
    const before = opening();
    const after = structuredClone(before);
    const kindred = after.enemies.find((e) => e.id === 'Kindred')!;
    kindred.position = 'gromp-red';
    const steps = buildReplay(before, after, [{ type: 'recall', champion: 'Kindred', itemsBought: 0 }]);
    expect(steps).toEqual([{ kind: 'recall', champion: 'Kindred', position: 'bluebuff-red' }]);
  });

  test('a ward spotting is a spotted step at the ward, played during the moves', () => {
    const before = opening();
    const steps = buildReplay(before, before, [
      { type: 'moved', champion: 'Fiora', from: 'top-t1-blue', to: 'top-lane', acted: true },
      { type: 'wardSpotted', side: 'blue', position: 'scuttle-top', champion: 'Garen', to: null },
    ]);
    const i = steps.findIndex((s) => s.kind === 'spotted');
    expect(steps[i]).toEqual({ kind: 'spotted', champion: 'Garen', position: 'scuttle-top', to: null });
    const [a, b] = stepWindow(steps, i);
    expect(a).toBeLessThan(0.4);
    expect(b).toBeLessThanOrEqual(0.6);
    // A spotting reveals nothing else: the hidden enemy gets no token.
    expect(tokensAt(before, steps, 0.3).some((t) => t.champion === 'Garen')).toBe(false);
  });

  test('a drawn fight sends the fighters back with a move after the fight', () => {
    const before = opening();
    const after = structuredClone(before);
    const events: GameEvent[] = [
      { type: 'moved', champion: 'Fiora', from: 'top-t1-blue', to: 'top-lane', acted: true },
      { type: 'fight', position: 'top-lane', blue: ['Fiora'], red: ['Garen'], winner: null, scores: { blue: 1, red: 1 } },
    ];
    expect(buildReplay(before, after, events).map((s) => s.kind === 'move' ? `${s.from}>${s.to}` : s.kind)).toEqual([
      'top-t1-blue>top-lane',
      'fight',
      'top-lane>top-t1-blue',
    ]);
  });

  test('taken objectives, cleared camps and towers pop a French label', () => {
    const before = opening();
    const events: GameEvent[] = [
      { type: 'objectiveTaken', objective: 'dragon', side: 'red', position: 'dragon-pit', champions: [] },
      { type: 'campCleared', camp: 'gromp-blue', champion: 'LeeSin' },
      { type: 'towerDamage', tower: 'top-t1-red', side: 'red', damage: 500, hp: 0, destroyed: true },
    ];
    expect(buildReplay(before, before, events)).toEqual([
      { kind: 'objective', position: 'dragon-pit', label: 'Dragon' },
      { kind: 'camp', position: 'gromp-blue', label: 'Camp nettoyé' },
      { kind: 'tower', position: 'top-t1-red', label: 'Tour détruite' },
    ]);
  });
});

describe('timeline', () => {
  test('first moves slide before the fight flash, deaths and labels come after', () => {
    const before = opening();
    const steps = buildReplay(before, before, [
      { type: 'moved', champion: 'Fiora', from: 'top-t1-blue', to: 'top-lane', acted: true },
      { type: 'fight', position: 'top-lane', blue: ['Fiora'], red: ['Garen'], winner: null, scores: { blue: 1, red: 1 } },
    ]);
    const [slide, fight, back] = steps.map((_, i) => stepWindow(steps, i));
    expect(slide![1]).toBeLessThanOrEqual(fight![0]);
    expect(fight![1]).toBeLessThanOrEqual(back![0]);
  });

  test('tokens slide from their old position to the new one', () => {
    const before = opening();
    const steps = buildReplay(before, moved(before, 'Fiora', 'top-lane'), [
      { type: 'moved', champion: 'Fiora', from: 'top-t1-blue', to: 'top-lane', acted: true },
    ]);
    const at = (t: number) => tokensAt(before, steps, t).find((x) => x.champion === 'Fiora')!;
    expect(at(0)).toMatchObject({ from: 'top-t1-blue', to: 'top-t1-blue', f: 0, opacity: 1 });
    expect(at(0.2)).toMatchObject({ from: 'top-t1-blue', to: 'top-lane', f: 0.5 });
    expect(at(1)).toMatchObject({ from: 'top-lane', to: 'top-lane', f: 0 });
  });

  test('a dead token fades out, a hidden enemy shows up only when its seen move starts', () => {
    const before = opening();
    const after = structuredClone(before);
    after.enemies.find((e) => e.id === 'Garen')!.visible = true;
    after.enemies.find((e) => e.id === 'Garen')!.position = 'top-lane';
    const steps = buildReplay(before, after, [
      { type: 'moved', champion: 'Garen', from: 'top-t1-red', to: 'top-lane', acted: true },
      { type: 'death', champion: 'Fiora', position: 'top-t1-blue', respawnRound: 4 },
    ]);
    const fiora = (t: number) => tokensAt(before, steps, t).find((x) => x.champion === 'Fiora')!;
    expect(fiora(0).opacity).toBe(1);
    expect(fiora(1).opacity).toBe(0);
    const garen = tokensAt(before, steps, 0).find((x) => x.champion === 'Garen');
    expect(garen).toMatchObject({ ally: false, from: 'top-t1-red', to: 'top-lane', f: 0 });
    expect(tokensAt(before, steps, 0.2).find((x) => x.champion === 'Garen')!.f).toBeCloseTo(0.5);
  });
});

describe('recall timeline', () => {
  test('the token reaches its step, stays there while the recall plays, then fades out', () => {
    const before = opening();
    const after = structuredClone(before);
    const fiora = after.allies.find((c) => c.id === 'Fiora')!;
    fiora.status = 'respawning';
    fiora.position = 'base-blue';
    const steps = buildReplay(before, after, [
      { type: 'moved', champion: 'Fiora', from: 'top-t1-blue', to: 'top-lane', acted: true },
      { type: 'recall', champion: 'Fiora', itemsBought: 1200 },
    ]);
    const at = (t: number) => tokensAt(before, steps, t).find((x) => x.champion === 'Fiora')!;
    const [a, b] = stepWindow(steps, 1);
    expect(a).toBeGreaterThanOrEqual(0.4);
    expect(at(a)).toMatchObject({ from: 'top-lane', to: 'top-lane', opacity: 1 });
    const mid = at(0.85);
    expect(mid).toMatchObject({ from: 'top-lane', to: 'top-lane' });
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    expect(at(b)).toMatchObject({ from: 'top-lane', to: 'top-lane', opacity: 0 });
  });
});

describe('parseReplayAt', () => {
  test('reads a fraction in [0, 1] from ?replayAt=, otherwise null', () => {
    expect(parseReplayAt('?autostart=1&replayAt=0.5')).toBe(0.5);
    expect(parseReplayAt('?replayAt=2')).toBe(1);
    expect(parseReplayAt('?replayAt=x')).toBeNull();
    expect(parseReplayAt('')).toBeNull();
  });
});
