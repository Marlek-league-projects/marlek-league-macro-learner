import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ObjectiveId } from '@lml/data/contracts';
import { choiceLabel, eventLines, eventText, objectiveActionLabel, recallIcon, zoneTitle } from '../src/components/format';

const data = loadGameData();

describe('eventText', () => {
  test('a cleared camp names the camp and who cleared it', () => {
    const vi = Object.keys(data.champions).find((id) => data.champions[id]!.name === 'Vi') ?? Object.keys(data.champions)[0]!;
    const name = data.champions[vi]!.name;
    expect(eventText({ type: 'campCleared', camp: 'krugs-blue', champion: vi }, data)).toBe(`Camp nettoyé : Krugs (bleu) par ${name}`);
  });
});

const name = (id: string) => data.champions[id]?.name ?? id;

describe('eventLines', () => {
  test('a move onto a camp and its clear by the same champion are one line', () => {
    const lines = eventLines([
      { type: 'moved', champion: 'LeeSin', from: 'bluebuff-blue', to: 'gromp-blue', acted: true },
      { type: 'campCleared', camp: 'gromp-blue', champion: 'LeeSin' },
      { type: 'campCleared', camp: 'krugs-blue', champion: 'Fiora' },
    ], data);
    expect(lines).toEqual([
      `${name('LeeSin')} se déplace vers Gromp (bleu) et tue le camp`,
      `Camp nettoyé : Krugs (bleu) par ${name('Fiora')}`,
    ]);
  });

  test('an arrival-only move says it takes no action', () => {
    expect(eventLines([{ type: 'moved', champion: 'LeeSin', from: 'bluebuff-blue', to: 'krugs-blue', acted: false }], data))
      .toEqual([`${name('LeeSin')} arrive à Krugs (bleu) (sans action)`]);
  });

  test('HP losses and ward spottings', () => {
    expect(eventText({ type: 'hpLost', champion: 'Fiora', amount: 15 }, data)).toBe(`${name('Fiora')} −15 PV`);
    expect(eventText({ type: 'wardSpotted', side: 'blue', position: 'scuttle-top', champion: 'Garen', to: 'baron-pit' }, data))
      .toBe(`Ward à Carapateur haut : ${name('Garen')} repéré → Fosse Nashor`);
    expect(eventText({ type: 'wardSpotted', side: 'blue', position: 'scuttle-top', champion: 'Garen', to: null }, data))
      .toBe(`Ward à Carapateur haut : ${name('Garen')} repéré`);
  });

  test('a cleared ward names who cleared it; a recall says where from', () => {
    expect(eventText({ type: 'wardCleared', side: 'blue', position: 'scuttle-top', champion: 'Garen' }, data))
      .toBe(`Ward bleu détruite à Carapateur haut par ${name('Garen')}`);
    expect(eventText({ type: 'recall', champion: 'Garen', position: 'scuttle-top', itemsBought: 300 }, data))
      .toBe(`${name('Garen')} rentre à la base depuis Carapateur haut et dépense 300 or`);
  });
});

describe('zone prompts', () => {
  const pits = (baron: ObjectiveId | null, dragon: ObjectiveId | null) => ({
    pits: {
      'baron-pit': { objective: baron, nextSpawn: null, capture: null },
      'dragon-pit': { objective: dragon, nextSpawn: null, capture: null },
    },
  });

  test('lane, river and camp zone titles', () => {
    expect(zoneTitle({ id: 'lane-top', position: 'top-t1-blue' }, pits(null, null), data, 600)).toBe('Lane top');
    expect(zoneTitle({ id: 'river-top', position: 'baron-pit' }, pits('baron', null), data, 1500)).toBe('Rivière haut (Carapateur + Nashor)');
    expect(zoneTitle({ id: 'river-bot', position: 'scuttle-bot' }, pits(null, 'dragon'), data, 600)).toBe('Rivière bas (Carapateur + Dragon)');
    expect(zoneTitle({ id: 'krugs-red', position: 'krugs-red' }, pits(null, null), data, 600)).toBe('Krugs (rouge)');
  });

  test('a river with nothing up names the objective its pit hosts next', () => {
    expect(zoneTitle({ id: 'river-top', position: 'scuttle-top' }, pits(null, null), data, 100)).toBe('Rivière haut (Carapateur + Larves)');
  });

  test('farm and objective choice labels', () => {
    expect(choiceLabel('pressure', 'farm')).toBe('Farmer sous la tour');
    expect(choiceLabel('objective', 'objective')).toBe("Continuer l'objectif");
    expect(choiceLabel('trade', 'fight')).toBe('All-in');
  });

  test('objective prompt button', () => {
    expect(objectiveActionLabel('dragon', false)).toBe('Faire le Dragon');
    expect(objectiveActionLabel('baron', true)).toBe('Faire le Nashor + Carapateur');
    expect(objectiveActionLabel('voidgrubs', false)).toBe('Faire les Larves');
  });

  test('the recall icon is the committed League asset', () => {
    expect(recallIcon()).toBe('./assets/recall.png');
    expect(existsSync(join(import.meta.dir, '..', 'public', 'assets', 'recall.png'))).toBe(true);
  });
});
