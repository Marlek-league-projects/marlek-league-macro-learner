import { useState } from 'preact/hooks';
import type { ChampionState, Order } from '@lml/engine/contracts';
import type { Store } from '../store';
import { championName, errorText, plural, positionLabel, roleIcon } from './format';

type Spot = 'from' | 'to';

function SpotChoice({ value, onPick, onlyFrom }: { value: Spot; onPick: (s: Spot) => void; onlyFrom?: boolean }) {
  return (
    <div class="seg indent">
      <button class={value === 'from' ? 'on' : ''} onClick={() => onPick('from')}>Départ</button>
      <button class={value === 'to' ? 'on' : ''} disabled={onlyFrom} onClick={() => onPick('to')}>Arrivée</button>
    </div>
  );
}

export function ActionsPanel({ store }: { store: Store }) {
  const [error, setError] = useState<{ champion: string; text: string } | null>(null);
  const view = store.view.value;
  const id = store.screen.value === 'orders' ? store.selected.value : null;
  const c = view?.allies.find((x) => x.id === id) ?? null;

  const run = (fn: () => void) => {
    try {
      fn();
      setError(null);
    } catch (err) {
      if (c) setError({ champion: c.id, text: errorText(err) });
    }
  };

  return (
    <div class="side">
      <h3>Actions</h3>
      {c ? <ChampionActions store={store} c={c} order={store.pending.value[c.id]} run={run} /> : (
        <div class="note">
          Clique un de tes pions sur la carte. Les positions atteignables ce round s'allument.
        </div>
      )}
      {c && error?.champion === c.id && <div class="error">{error.text}</div>}
    </div>
  );
}

interface ActionsProps {
  store: Store;
  c: ChampionState;
  order: Order | undefined;
  run: (fn: () => void) => void;
}

function ChampionActions({ store, c, order, run }: ActionsProps) {
  const { data } = store;
  const header = (
    <div>
      <img class="ri" src={roleIcon(c.role)} alt="" />
      <strong>{championName(data, c.id)}</strong>
      {c.status === 'alive' && <> · {positionLabel(data, c.position)}</>}
    </div>
  );

  if (c.status === 'dead') {
    return <>{header}<div class="neg">Mort (retour round {c.respawnRound})</div></>;
  }

  if (c.status === 'respawning') {
    const points = store.spawnPointsFor(c.id);
    const chosen = order?.kind === 'spawn' ? order.to : points[0];
    return (
      <>
        {header}
        <div class="note">Choisis où réapparaître :</div>
        <div class="stack">
          {points.map((p) => (
            <button key={p} class={p === chosen ? 'on' : ''} onClick={() => run(() => store.setSpawn(c.id, p))}>
              {positionLabel(data, p)}
            </button>
          ))}
        </div>
        <button class="wide" onClick={() => run(() => store.clearOrder(c.id))}>Annuler l'ordre</button>
      </>
    );
  }

  const moves = c.role === 'jungle' ? data.rules.moves.jungler : data.rules.moves.laner;
  const move = order?.kind === 'move' ? order : null;
  const recall = order?.kind === 'recall' ? order : null;
  const ward = move?.ward ?? recall?.ward;
  const wardSpot: Spot = ward === 'to' ? 'to' : 'from';
  const canUnward = data.rules.wards.unwardRoles.includes(c.role);
  const target = data.graph.positions[move?.to ?? c.position];
  const heraldTarget = c.hasHerald && target?.kind === 'tower' && target.side !== c.side;

  return (
    <>
      {header}
      <div class="note">
        Portée : {plural(moves, 'mouvement')}. Clique une position allumée.
      </div>
      <div class="opt">
        <label>
          <input
            type="checkbox"
            checked={ward !== undefined}
            onChange={(e) => run(() => store.setWard(c.id, (e.currentTarget as HTMLInputElement).checked ? 'from' : null))}
          />{' '}
          Poser une ward
        </label>
        {ward !== undefined && typeof ward !== 'object' && (
          <SpotChoice value={wardSpot} onlyFrom={!!recall} onPick={(s) => run(() => store.setWard(c.id, s))} />
        )}
        {canUnward && (
          <>
            <label>
              <input
                type="checkbox"
                checked={move?.unward !== undefined}
                onChange={(e) => run(() => store.setUnward(c.id, (e.currentTarget as HTMLInputElement).checked ? 'from' : null))}
              />{' '}
              Unward
            </label>
            {move?.unward !== undefined && (
              <SpotChoice value={move.unward} onPick={(s) => run(() => store.setUnward(c.id, s))} />
            )}
          </>
        )}
        <button class={`wide${recall ? ' on' : ''}`} onClick={() => run(() => store.setRecall(c.id))}>Recall</button>
        {heraldTarget && (
          <button
            class={`wide${move?.launchHerald ? ' on' : ''}`}
            onClick={() => run(() => store.setLaunchHerald(c.id, !move?.launchHerald))}
          >
            Lancer le Herald
          </button>
        )}
        <button class="wide" onClick={() => run(() => store.clearOrder(c.id))}>Annuler l'ordre</button>
      </div>
    </>
  );
}
