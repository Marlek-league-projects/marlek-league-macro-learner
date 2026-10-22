import type { Store } from '../store';
import { answerQuit, askQuit, quitAsked } from './quit';

/** "Quitter la partie" in the score bar, on every game screen, with its confirmation inside the page. */
export function QuitGame({ store }: { store: Store }) {
  if (!quitAsked.value) {
    return (
      <button class="quit-game" onClick={askQuit} title="Abandonner la partie et revenir à l'écran de départ">
        Quitter la partie
      </button>
    );
  }
  return (
    <div class="quit-confirm" role="alertdialog" aria-label="Quitter la partie ?">
      <span>Quitter la partie ?</span>
      <button class="quit-yes" onClick={() => answerQuit(store, true)}>Oui</button>
      <button class="quit-no" onClick={() => answerQuit(store, false)}>Non</button>
    </div>
  );
}
