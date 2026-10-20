import { useState } from 'preact/hooks';
import type { ChampionState, Order, Stance } from '@lml/engine/contracts';
import type { Store } from '../store';
import { EventLog } from './EventLog';
import { shownRound } from './RoundBanner';
import { championName, clock, errorText, OBJECTIVE_LABEL, objectiveTimers, positionLabel } from './format';

/** Rounds until the objective spawning at `at` is up (it spawns during the round whose window ends at or after it). */
function roundsUntil(store: Store, round: number, at: number): number | null {
  for (let r = round; r <= store.totalRounds(); r++) {
    if (store.roundWindow(r).end >= at) return r - round;
  }
  return null;
}

function NextObjective({ store }: { store: Store }) {
  const view = store.view.value!;
  const { alive, next } = objectiveTimers(view, store.data);
  const wait = next ? roundsUntil(store, view.round, next.at) : null;
  return (
    <>
      {alive.length > 0 && (
        <div class="note">En jeu : {alive.map((o) => OBJECTIVE_LABEL[o]).join(', ')}</div>
      )}
      {next && wait !== null && (
        <div class="note">
          Prochain objectif : {OBJECTIVE_LABEL[next.objective]} à {clock(next.at)}{' '}
          ({wait === 0 ? 'ce round' : `dans ${wait} round${wait > 1 ? 's' : ''}`})
        </div>
      )}
    </>
  );
}

const STANCE_TEXT: Record<Stance, string> = { farm: 'farm', trade: 'trade', allin: 'all-in' };
const stanceText = (s: Stance | undefined): string[] => (s ? [`posture ${STANCE_TEXT[s]}`] : []);

function orderText(store: Store, c: ChampionState, o: Order | undefined): string {
  const at = (id: string) => positionLabel(store.data, id);
  if (c.status === 'dead') return `mort (retour round ${c.respawnRound})`;
  if (c.status === 'respawning') {
    const to = o?.kind === 'spawn' ? o.to : store.spawnPointsFor(c.id)[0];
    return to ? `réapparaît à ${at(to)}` : 'réapparaît';
  }
  if (o?.kind === 'recall') {
    return [o.to ? `→ ${at(o.to)} puis recall` : 'recall', ...(o.ward ? ['ward au départ'] : []), ...stanceText(o.stance)].join(' · ');
  }
  const parts: string[] = [];
  parts.push(o?.kind === 'move' && o.to !== c.position ? `→ ${at(o.to)}` : 'reste en place');
  if (o?.kind === 'move') {
    if (o.ward === 'from') parts.push('ward au départ');
    else if (o.ward === 'to') parts.push("ward à l'arrivée");
    else if (o.ward) parts.push(`ward à ${at(o.ward.position)}`);
    if (o.unward === 'from') parts.push('unward au départ');
    else if (o.unward === 'to') parts.push("unward à l'arrivée");
    if (o.launchHerald) parts.push('lance le Herald');
    parts.push(...stanceText(o.stance));
  }
  return parts.join(' · ');
}

function Orders({ store }: { store: Store }) {
  const [error, setError] = useState<string | null>(null);
  const view = store.view.value!;
  const pending = store.pending.value;
  const confirm = () => {
    try {
      store.confirmRound();
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <>
      <div>
        <h3>Ordres du round</h3>
        <div class="note">Clique un de tes pions sur la carte : ses actions s'ouvrent à côté de lui.</div>
        <ul class="orders">
          {view.allies.map((c) => (
            <li key={c.id}>{championName(store.data, c.id)} : {orderText(store, c, pending[c.id])}</li>
          ))}
        </ul>
      </div>
      <button class="go" onClick={confirm}>Valider le round</button>
      {error && <div class="error">{error}</div>}
      {store.settings.value.teaching && (
        <div class="note">Mode didactique : les explications s'affichent ici après la résolution du round.</div>
      )}
    </>
  );
}

export function RoundPanel({ store }: { store: Store }) {
  const view = store.view.value;
  if (!view) return null;
  const screen = store.screen.value;
  const round = shownRound(store);
  const win = store.roundWindow(round);
  const phase = store.data.rules.phases[win.phase];
  return (
    <div class="side">
      <div>
        <h3>Résumé du round</h3>
        <div>
          <strong>Phase {win.phase + 1} · Round {round}/{store.totalRounds()}</strong> · {clock(win.start)} → {clock(win.end)}
        </div>
        {phase && <div class="note">{phase.name}</div>}
        {screen !== 'review' && <NextObjective store={store} />}
      </div>
      {screen === 'orders' && <Orders store={store} />}
      {screen === 'contacts' && <div class="note">Réponds aux contacts dans le panneau sur la carte.</div>}
      {screen === 'review' && (
        <>
          {store.previousView.value && (
            <div class="replay-ctl">
              <button onClick={() => store.replay()}>Rejouer</button>
              <button onClick={() => store.skipReplay()} disabled={!store.replaying.value}>Passer</button>
            </div>
          )}
          <EventLog store={store} />
          <button class="go" onClick={() => store.next()}>Round suivant</button>
        </>
      )}
    </div>
  );
}
