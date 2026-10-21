import { signal } from '@preact/signals';
import type { Store } from '../store';
import { errorText } from './format';

/** Why the last "Valider le round" failed, shown under the orders; null once a round is validated. */
export const confirmError = signal<string | null>(null);

/** Validates the round's orders (from the banner button, the panel button or the Enter key). */
export function confirmRound(store: Store): void {
  try {
    store.confirmRound();
    confirmError.value = null;
  } catch (err) {
    confirmError.value = errorText(err);
  }
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  target: { tagName: string; isContentEditable: boolean } | null;
}

const OWN_ENTER = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

/** A bare Enter press with no field or control focused (those keep their own Enter). */
export function isConfirmKey(e: KeyLike): boolean {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return false;
  return !e.target || (!OWN_ENTER.has(e.target.tagName) && !e.target.isContentEditable);
}
