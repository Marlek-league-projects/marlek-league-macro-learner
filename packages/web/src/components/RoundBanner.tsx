import type { Store } from '../store';
import { clock } from './format';

/** The round on screen: in review the view has already moved on, so it is the round just played. */
export function shownRound(store: Store): number {
  const view = store.view.value!;
  return store.screen.value === 'review' ? view.round - 1 : view.round;
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
