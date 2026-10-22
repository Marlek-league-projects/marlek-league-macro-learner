import { signal } from '@preact/signals';
import type { Store } from '../store';

/** "Quitter la partie" was clicked: the score bar asks "Quitter la partie ? Oui / Non" in the page (never a browser dialog). */
export const quitAsked = signal(false);

export function askQuit(): void {
  quitAsked.value = true;
}

/** Oui: back to the start screen (the game is dropped). Non: the game goes on as it was. */
export function answerQuit(store: Store, yes: boolean): void {
  quitAsked.value = false;
  if (yes) store.reset();
}
