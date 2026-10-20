import type { Store } from '../store';
import { clock, shownRound as roundOn } from './format';

/** The round on screen (see format.shownRound). */
export function shownRound(store: Store): number {
  return roundOn(store.screen.value, store.view.value!.round);
}

/** "Round N/37 · m:ss → m:ss · phase", large, at the top of the page. */
export function RoundBanner({ store }: { store: Store }) {
  if (!store.view.value) return null;
  const round = shownRound(store);
  const win = store.roundWindow(round);
  const phase = store.data.rules.phases[win.phase];
  return (
    <div class="banner">
      Round {round}/{store.totalRounds()} · {clock(win.start)} → {clock(win.end)}
      {phase && <> · <span class="phase">{phase.name}</span></>}
    </div>
  );
}
