import { describe, expect, test } from 'bun:test';
import { pawnClick } from '../src/components/pawn-click';

const reach = { 'top-lane': 1, 'gromp-blue': 1 };

describe('pawnClick', () => {
  test('clicking the selected pawn deselects it', () => {
    expect(pawnClick({ id: 'Vi', position: 'gromp-blue', ally: true }, 'Vi', reach)).toEqual({ kind: 'select', id: null });
  });

  test('an ally on a reachable position is an order target, not a new selection', () => {
    expect(pawnClick({ id: 'Fiora', position: 'top-lane', ally: true }, 'Vi', reach)).toEqual({ kind: 'order', to: 'top-lane' });
  });

  test('an enemy on a reachable position is an order target', () => {
    expect(pawnClick({ id: 'Ornn', position: 'top-lane', ally: false }, 'Vi', reach)).toEqual({ kind: 'order', to: 'top-lane' });
  });

  test('an ally out of reach is selected instead', () => {
    expect(pawnClick({ id: 'Ashe', position: 'bot-lane', ally: true }, 'Vi', reach)).toEqual({ kind: 'select', id: 'Ashe' });
  });

  test('with nothing selected an ally is selected and an enemy does nothing', () => {
    expect(pawnClick({ id: 'Ashe', position: 'bot-lane', ally: true }, null, null)).toEqual({ kind: 'select', id: 'Ashe' });
    expect(pawnClick({ id: 'Ornn', position: 'top-lane', ally: false }, null, null)).toEqual({ kind: 'none' });
  });

  test('an enemy out of reach does nothing', () => {
    expect(pawnClick({ id: 'Ornn', position: 'mid-lane', ally: false }, 'Vi', reach)).toEqual({ kind: 'none' });
  });
});
