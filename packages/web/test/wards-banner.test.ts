import { describe, expect, test } from 'bun:test';
import { wardExpiryRound, wardRoundsLeft, wardTooltip } from '../src/components/wards';
import { bannerHasReplay, bannerPrimary } from '../src/components/banner-action';

describe('wards', () => {
  test('rounds left', () => {
    expect(wardRoundsLeft(4, 5)).toBe(1);
    expect(wardRoundsLeft(4, 6)).toBe(1);
    expect(wardExpiryRound(4)).toBe(5);
    expect(wardTooltip(4)).toBe('Ward (expire au round 5)');
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
