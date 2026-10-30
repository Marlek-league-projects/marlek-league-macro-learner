import type { Store } from '../store';
import { answerQuit, askQuit } from './quit';

/** "Quitter la partie" in the score bar, on every game screen, with its confirmation inside the page. */
export function QuitGame({ store }: { store: Store }) {
  if (!store.quitAsked.value) {
    return (
      <button class="px-2 py-1 text-[12px] opacity-80 hover:opacity-100" onClick={() => askQuit(store)} title="Abandonner la partie et revenir à l'écran de départ">
        Quitter la partie
      </button>
    );
  }
  return (
    <div class="flex items-center gap-1.5 whitespace-nowrap text-[12px]" role="alertdialog" aria-label="Quitter la partie ?">
      <span>Quitter la partie ?</span>
      <button class="border-red-side" onClick={() => answerQuit(store, true)}>Oui</button>
      <button onClick={() => answerQuit(store, false)}>Non</button>
    </div>
  );
}
