import type { ChampionState, Order, Stance } from '@lml/engine/contracts';
import type { Store } from '../store';
import { confirmError, confirmRound } from './confirm-round';
import { EventLog } from './EventLog';
import { shownRound } from './RoundBanner';
import { championName, clock, idleText, noOrderText, OBJECTIVE_LABEL, objectiveTimers, placementWindow, positionLabel } from './format';

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

const STANCE_TEXT: Record<Stance, string> = { push: 'push', farm: 'farm', trade: 'trade', allin: 'all-in' };
const stanceText = (s: Stance | undefined): string[] => (s ? [`posture ${STANCE_TEXT[s]}`] : []);

function orderText(store: Store, c: ChampionState, o: Order | undefined): string {
  const at = (id: string) => positionLabel(store.data, id);
  if (c.status === 'dead') return `mort (retour round ${c.respawnRound})`;
  if (c.status === 'respawning') {
    const to = o?.kind === 'spawn' ? o.to : store.defaultSpawn(c.id);
    return to ? `réapparaît à ${at(to)}` : 'réapparaît';
  }
  if (o?.kind === 'recall') {
    return [o.to ? `→ ${at(o.to)} puis recall` : 'recall', ...(o.ward ? ['ward au départ'] : []), ...stanceText(o.stance)].join(' · ');
  }
  const parts: string[] = [];
  const idle = idleText(store.followsWave(c.id));
  parts.push(o?.kind === 'move' && o.to !== c.position ? `→ ${at(o.to)}` : idle);
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
  const view = store.view.value!;
  const pending = store.pending.value;
  const error = confirmError.value;
  const idle = store.championsWithoutOrder();
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
        {idle.length > 0 && (
          <div class="note noorder">{noOrderText(idle.map((id) => championName(store.data, id)))}</div>
        )}
      </div>
      <button class="go" onClick={() => confirmRound(store)}>Valider le round</button>
      {error && <div class="error">{error}</div>}
      {store.settings.value.teaching && (
        <div class="note">Mode didactique : les explications s'affichent ici après la résolution du round.</div>
      )}
    </>
  );
}

/** Round 0: where each own champion starts, and "Valider le placement". */
function Placement({ store }: { store: Store }) {
  const view = store.view.value!;
  return (
    <>
      <div>
        <h3>Placement de départ</h3>
        <div class="note">
          Clique un de tes champions puis n'importe quelle position de ton côté de la carte (tours, camps, base) ou le
          milieu d'une voie. Plusieurs champions peuvent partager une position. Les camps apparaissent à partir de{' '}
          {clock(store.data.rules.phases[0]?.start ?? 0)} : aucun n'est nettoyé avant le round 1.
        </div>
        <ul class="orders placement-list">
          {view.allies.map((c) => (
            <li key={c.id}>{championName(store.data, c.id)} : {positionLabel(store.data, c.position)}</li>
          ))}
        </ul>
      </div>
      <button class="go" onClick={() => store.confirmPlacement()}>Valider le placement</button>
    </>
  );
}

export function RoundPanel({ store }: { store: Store }) {
  const view = store.view.value;
  if (!view) return null;
  const screen = store.screen.value;
  const round = shownRound(store);
  if (round === 0) {
    const w = placementWindow(store.data.rules);
    return (
      <div class="side">
        <div>
          <h3>Résumé du round</h3>
          <div><strong>Round 0 · placement</strong> · {clock(w.start)} → {clock(w.end)}</div>
        </div>
        <Placement store={store} />
      </div>
    );
  }
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
              <button onClick={() => store.replay()} title="Rejouer l'animation du tour">Revoir le tour</button>
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
