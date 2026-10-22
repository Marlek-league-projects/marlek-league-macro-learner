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
        <div class="teams-row">
          <TeamPanel store={store} team="ally" />
          <TeamPanel store={store} team="enemy" />
        </div>
      </>
    );
  }
  return (
    <div class="game">
      <TeamPanel store={store} team="ally" />
      <div class="center">
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
    <div class="wrap">
      <header class="head">
        {playing ? (
          <ScoreBar store={store} subtitle={`League Macro Learner · IA ${profile?.label ?? rank} · graine ${seed}`} />
        ) : (
          <h1>League Macro Learner</h1>
        )}
      </header>
      {playing ? <Game store={store} /> : <StartScreen store={store} />}
      <footer class="legal">{LEGAL}</footer>
    </div>
  );
}
