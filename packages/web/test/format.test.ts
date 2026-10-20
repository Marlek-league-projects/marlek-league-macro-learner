import { describe, expect, test } from 'bun:test';
import { loadGameData } from '@lml/data';
import { eventText } from '../src/components/format';

const data = loadGameData();

describe('eventText', () => {
  test('a cleared camp names the camp and who cleared it', () => {
    const vi = Object.keys(data.champions).find((id) => data.champions[id]!.name === 'Vi') ?? Object.keys(data.champions)[0]!;
    const name = data.champions[vi]!.name;
    expect(eventText({ type: 'campCleared', camp: 'krugs-blue', champion: vi }, data)).toBe(`Camp nettoyé : Krugs (bleu) par ${name}`);
  });
});
