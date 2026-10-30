import { useEffect } from 'preact/hooks';
import type { Store } from './store';
import { bannerPrimary, runBannerAction } from './components/banner-action';
import { isConfirmKey } from './components/confirm-round';
import { GameOver } from './components/GameOver';
import { MapView } from './components/MapView';
import { RoundPanel } from './components/RoundPanel';
import { ScoreBar } from './components/ScoreBar';
import { StartScreen } from './components/StartScreen';
import { TeamPanel } from './components/TeamPanel';

const LEGAL =
  "League Macro Learner n'est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de " +
  'quiconque officiellement impliqué dans la production ou la gestion de League of Legends.';

/** Teams on the sides like League: your column, the map with the round panel below it, the enemy column. */
function Game({ store }: { store: Store }) {
  // Enter triggers the banner's primary action (validate / next round), unless a field or a control has the focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const primary = bannerPrimary(store.screen.value);
      // While "Quitter la partie ?" is asked, Enter does nothing (the player answers Oui or Non).
      if (!primary?.enter || store.quitAsked.value) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const { key, ctrlKey, metaKey, altKey, shiftKey, repeat } = e;
      if (!isConfirmKey({ key, ctrlKey, metaKey, altKey, shiftKey, repeat, target: t })) return;
      e.preventDefault();
      runBannerAction(store, primary.action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);
  if (store.screen.value === 'over') {
    return (
      <>
        <GameOver store={store} />
        <div class="grid grid-cols-2 gap-3">
          <TeamPanel store={store} team="ally" />
          <TeamPanel store={store} team="enemy" />
        </div>
      </>
    );
  }
  return (
    <div class="my-2.5 grid grid-cols-[minmax(180px,230px)_minmax(0,1fr)_minmax(180px,230px)] items-start gap-3">
      <TeamPanel store={store} team="ally" />
      <div class="flex min-w-0 flex-col items-center gap-3">
        <MapView store={store} />
        <RoundPanel store={store} />
      </div>
      <TeamPanel store={store} team="enemy" />
    </div>
  );
}

export function App({ store }: { store: Store }) {
  const { rank, seed } = store.settings.value;
  const profile = store.data.aiProfiles.find((p) => p.rank === rank);
  const playing = store.screen.value !== 'start';
  return (
    <div class="mx-auto max-w-[1600px] px-4 pt-3 pb-6">
      <header>
        {playing ? (
          <ScoreBar store={store} subtitle={`League Macro Learner · IA ${profile?.label ?? rank} · graine ${seed}`} />
        ) : (
          <h1 class="text-[13px] font-medium text-mut">League Macro Learner</h1>
        )}
      </header>
      {playing ? <Game store={store} /> : <StartScreen store={store} />}
      <footer class="mt-4 text-center text-[11px] text-mut">{LEGAL}</footer>
    </div>
  );
}
