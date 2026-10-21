import { describe, expect, test } from 'bun:test';
import { wardTooltip } from '../src/components/wards';
import { bannerHasReplay, bannerPrimary } from '../src/components/banner-action';

describe('wards', () => {
  test('tooltip: the last active round from the engine rounds left; the scuttle ward is named', () => {
    expect(wardTooltip({}, 2, 5)).toBe('Ward (expire au round 6)');
    expect(wardTooltip({}, 1, 5)).toBe('Ward (expire au round 5)');
    expect(wardTooltip({ scuttle: true }, 2, 5)).toBe('Ward du Carapateur');
  });
});

describe('banner', () => {
  test('primary action per screen', () => {
    expect(bannerPrimary('orders')?.label).toBe('Valider le round');
    expect(bannerPrimary('review')).toEqual({ action: 'next', label: 'Round suivant', enter: true });
    expect(bannerPrimary('over')?.enter).toBe(false);
    expect(bannerPrimary('contacts')).toBeNull();
  });
  test('replay button after a resolved round', () => {
    expect(bannerHasReplay('review')).toBe(true);
    expect(bannerHasReplay('over')).toBe(true);
    expect(bannerHasReplay('orders')).toBe(false);
  });
});
