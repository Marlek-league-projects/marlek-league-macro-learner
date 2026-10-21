import { describe, expect, test } from 'bun:test';
import { isConfirmKey } from '../src/components/confirm-round';

const key = (over: Partial<Parameters<typeof isConfirmKey>[0]> = {}) => ({
  key: 'Enter',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  target: { tagName: 'BODY', isContentEditable: false },
  ...over,
});

describe('isConfirmKey', () => {
  test('Enter with nothing focused validates the round', () => {
    expect(isConfirmKey(key())).toBe(true);
    expect(isConfirmKey(key({ target: null }))).toBe(true);
  });

  test('other keys, modifiers and auto-repeat do not', () => {
    expect(isConfirmKey(key({ key: 'a' }))).toBe(false);
    expect(isConfirmKey(key({ ctrlKey: true }))).toBe(false);
    expect(isConfirmKey(key({ metaKey: true }))).toBe(false);
    expect(isConfirmKey(key({ altKey: true }))).toBe(false);
    expect(isConfirmKey(key({ shiftKey: true }))).toBe(false);
    expect(isConfirmKey(key({ repeat: true }))).toBe(false);
  });

  test('Enter in a field or on a focused control keeps its own meaning', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']) {
      expect(isConfirmKey(key({ target: { tagName, isContentEditable: false } }))).toBe(false);
    }
    expect(isConfirmKey(key({ target: { tagName: 'DIV', isContentEditable: true } }))).toBe(false);
  });
});
