import type { Store } from '../store';
import { bannerHasReplay, bannerPrimary, runBannerAction } from './banner-action';
import { shownRound as roundOn } from './format';
import { go } from './ui';

/** The round on screen (see format.shownRound); round 0 is the placement. */
export function shownRound(store: Store): number {
  return roundOn(store.screen.value, store.view.value!.round);
}

/**
 * The round's buttons, in the middle of the score bar: "Valider le placement" in round 0, "Valider le round" while
 * giving orders (Enter does the same), "Round suivant" / "Nouvelle partie" after it, and "Revoir le tour" once a
 * round has resolved.
 */
export function RoundActions({ store }: { store: Store }) {
  if (!store.view.value) return null;
  const primary = bannerPrimary(store.screen.value);
  return (
    <div class="flex flex-col gap-1">
      {primary && (
        <button class={`${go} text-[14px]`} onClick={() => runBannerAction(store, primary.action)} title={primary.enter ? 'Raccourci : Entrée' : undefined}>
          {primary.label}
        </button>
      )}
      {bannerHasReplay(store.screen.value) && store.previousView.value && (
        <button class="px-3 py-1.5 text-[14px]" onClick={() => store.replay()} title="Rejouer l'animation du tour">
          Revoir le tour
        </button>
      )}
    </div>
  );
}
