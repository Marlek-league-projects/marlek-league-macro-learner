import type { Store } from '../store';

/** "Quitter la partie": the score bar asks "Quitter la partie ? Oui / Non" in the page (never a browser dialog). */
export function askQuit(store: Store): void {
  store.quitAsked.value = true;
}

/** Oui: back to the start screen (the game is dropped). Non: the game goes on as it was. */
export function answerQuit(store: Store, yes: boolean): void {
  store.quitAsked.value = false;
  if (yes) store.reset();
}
