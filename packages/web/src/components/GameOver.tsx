import type { Store } from '../store';
import { EventLog } from './EventLog';
import { MapView } from './MapView';
import { clock, num } from './format';
import { go, heading, note, panel } from './ui';

const ROWS = [
  ['gold', 'Or gagné'],
  ['objectives', 'Objectifs'],
  ['plates', 'Plaques'],
  ['towers', 'Tours'],
] as const;

const cell = 'border-b border-line px-1.5 py-1 text-right';
const rowLabel = 'border-b border-line px-1.5 py-1 text-left';

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
    <div class="my-3 grid grid-cols-[220px_minmax(0,1fr)_220px] items-start gap-3">
      <div class={panel}>
        <h2 class={`text-[18px] font-bold ${view.winner === 'draw' ? '' : view.winner === view.side ? 'text-green-400' : 'text-red-400'}`}>{title}</h2>
        <div class={note}>Fin de partie à {end} : l'équipe au plus haut score l'emporte.</div>
        <table class="w-full border-collapse">
          <thead>
            <tr><th class={rowLabel} /><th class={`${cell} text-blue-side`}>Ton équipe</th><th class={`${cell} text-red-side`}>Adversaire</th></tr>
          </thead>
          <tbody>
            {ROWS.map(([key, label]) => (
              <tr key={key}><td class={`${rowLabel} text-mut`}>{label}</td><td class={cell}>{num(mine[key])}</td><td class={cell}>{num(theirs[key])}</td></tr>
            ))}
            <tr class="font-bold"><td class={rowLabel}>Score</td><td class={cell}>{num(mine.total)}</td><td class={cell}>{num(theirs.total)}</td></tr>
          </tbody>
        </table>
        <button class={go} onClick={() => store.reset()}>Nouvelle partie</button>
      </div>
      <MapView store={store} />
      <div class={panel}>
        <h3 class={heading}>Dernier round</h3>
        {store.previousView.value && (
          <div class="flex gap-1.5 *:flex-1">
            <button onClick={() => store.replay()} title="Rejouer l'animation du tour">Revoir le tour</button>
            <button onClick={() => store.skipReplay()} disabled={!store.replaying.value}>Passer</button>
          </div>
        )}
        <EventLog store={store} />
      </div>
    </div>
  );
}
