import type { Store } from '../store';
import { EventLog } from './EventLog';
import { MapView } from './MapView';
import { clock, num } from './format';

const ROWS = [
  ['gold', 'Or gagné'],
  ['objectives', 'Objectifs'],
  ['plates', 'Plaques'],
  ['towers', 'Tours'],
] as const;

/** Final scores, the map replaying the last round, and that round's events. */
export function GameOver({ store }: { store: Store }) {
  const view = store.view.value;
  const scores = store.finalScores();
  if (!view || !scores) return null;
  const mine = scores[view.side];
  const theirs = scores[view.side === 'blue' ? 'red' : 'blue'];
  const end = clock(store.roundWindow(store.totalRounds()).end);
  const title = view.winner === 'draw' ? 'Égalité' : view.winner === view.side ? 'Victoire !' : 'Défaite';
  return (
    <div class="over">
      <div class="side">
        <h2 class={view.winner === 'draw' ? '' : view.winner === view.side ? 'pos' : 'neg'}>{title}</h2>
        <div class="note">Fin de partie à {end} : l'équipe au plus haut score l'emporte.</div>
        <table class="score">
          <thead>
            <tr><th /><th style="color:var(--blue)">Ton équipe</th><th style="color:var(--red)">Adversaire</th></tr>
          </thead>
          <tbody>
            {ROWS.map(([key, label]) => (
              <tr key={key}><td>{label}</td><td>{num(mine[key])}</td><td>{num(theirs[key])}</td></tr>
            ))}
            <tr class="total"><td>Score</td><td>{num(mine.total)}</td><td>{num(theirs.total)}</td></tr>
          </tbody>
        </table>
        <button class="go" onClick={() => store.reset()}>Nouvelle partie</button>
      </div>
      <MapView store={store} />
      <div class="side">
        <h3>Dernier round</h3>
        {store.previousView.value && (
          <div class="replay-ctl">
            <button onClick={() => store.replay()} title="Rejouer l'animation du tour">Revoir le tour</button>
            <button onClick={() => store.skipReplay()} disabled={!store.replaying.value}>Passer</button>
          </div>
        )}
        <EventLog store={store} />
      </div>
    </div>
  );
}
