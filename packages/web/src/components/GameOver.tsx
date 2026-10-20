import type { Store } from '../store';
import { EventLog } from './EventLog';
import { clock, num } from './format';

const ROWS = [
  ['gold', 'Or gagné'],
  ['objectives', 'Objectifs'],
  ['plates', 'Plaques'],
  ['towers', 'Tours'],
] as const;

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
        <button class="go" onClick={() => { store.screen.value = 'start'; }}>Rejouer</button>
      </div>
      <div class="side">
        <h3>Dernier round</h3>
        <EventLog store={store} />
      </div>
    </div>
  );
}
