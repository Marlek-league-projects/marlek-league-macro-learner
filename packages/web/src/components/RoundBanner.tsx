import type { Store } from '../store';
import { confirmRound } from './confirm-round';
import { bannerHasReplay, bannerPrimary } from './banner-action';
import { clock, shownRound as roundOn } from './format';

/** The round on screen (see format.shownRound). */
export function runBannerAction(store: Store, action: 'confirm' | 'next' | 'new'): void {
  if (action === 'confirm') confirmRound(store);
  else if (action === 'next') store.next();
  else store.reset();
}

export function shownRound(store: Store): number {
  return roundOn(store.screen.value, store.view.value!.round);
}

/**
 * "Round N/71 · m:ss → m:ss · phase", large, at the top of the page; while giving orders, a "Valider le round"
 * button next to it (Enter does the same), so validating never needs a scroll.
 */
export function RoundBanner({ store }: { store: Store }) {
  if (!store.view.value) return null;
  const round = shownRound(store);
  const win = store.roundWindow(round);
  const phase = store.data.rules.phases[win.phase];
  const primary = bannerPrimary(store.screen.value);
  return (
    <div class="banner">
      Round {round}/{store.totalRounds()} · {clock(win.start)} → {clock(win.end)}
      {phase && <> · <span class="phase">{phase.name}</span></>}
      {primary && (
        <button class="go banner-go" onClick={() => runBannerAction(store, primary.action)} title={primary.enter ? 'Raccourci : Entrée' : undefined}>
          {primary.label}
        </button>
      )}
      {bannerHasReplay(store.screen.value) && store.previousView.value && (
        <button class="banner-replay" onClick={() => store.replay()} title="Rejouer l'animation du tour">
          Revoir le tour
        </button>
      )}
    </div>
  );
}
