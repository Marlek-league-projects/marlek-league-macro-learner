import { useEffect } from 'preact/hooks';
import type { Store } from './store';
import { confirmRound, isConfirmKey } from './components/confirm-round';
import { GameOver } from './components/GameOver';
import { MapView } from './components/MapView';
import { RoundBanner } from './components/RoundBanner';
import { RoundPanel } from './components/RoundPanel';
import { Scoreboard } from './components/Scoreboard';
import { StartScreen } from './components/StartScreen';
import { TeamPanel } from './components/TeamPanel';

const LEGAL =
  "League Macro Learner n'est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de " +
  'quiconque officiellement impliqué dans la production ou la gestion de League of Legends.';

/** Teams on the sides like League: your column, the map with the round panel below it, the enemy column. */
function Game({ store }: { store: Store }) {
  // Enter validates the round while giving orders, unless a field or a control has the focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (store.screen.value !== 'orders') return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const { key, ctrlKey, metaKey, altKey, shiftKey, repeat } = e;
      if (!isConfirmKey({ key, ctrlKey, metaKey, altKey, shiftKey, repeat, target: t })) return;
      e.preventDefault();
      confirmRound(store);
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
        {playing && <RoundBanner store={store} />}
        {playing && <Scoreboard store={store} />}
        <h1>
          League Macro Learner
          {playing && <span class="muted"> · IA {profile?.label ?? rank} · graine {seed}</span>}
        </h1>
      </header>
      {playing ? <Game store={store} /> : <StartScreen store={store} />}
      <footer class="legal">{LEGAL}</footer>
    </div>
  );
}
