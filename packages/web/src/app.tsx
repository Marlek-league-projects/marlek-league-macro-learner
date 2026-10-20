import type { Store } from './store';
import { ActionsPanel } from './components/ActionsPanel';
import { GameOver } from './components/GameOver';
import { MapView } from './components/MapView';
import { RoundBanner } from './components/RoundBanner';
import { RoundPanel } from './components/RoundPanel';
import { StartScreen } from './components/StartScreen';
import { TeamPanel } from './components/TeamPanel';

const LEGAL =
  "League Macro Learner n'est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de " +
  'quiconque officiellement impliqué dans la production ou la gestion de League of Legends.';

function Game({ store }: { store: Store }) {
  const over = store.screen.value === 'over';
  return (
    <>
      <TeamPanel store={store} team="ally" />
      {over ? (
        <GameOver store={store} />
      ) : (
        <div class="mid">
          <ActionsPanel store={store} />
          <MapView store={store} />
          <RoundPanel store={store} />
        </div>
      )}
      <TeamPanel store={store} team="enemy" />
    </>
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
