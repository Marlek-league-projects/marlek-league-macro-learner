import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ChampionState, Order, Stance } from '@lml/engine/contracts';
import type { GameData } from '@lml/data/contracts';
import type { Store } from '../store';
import { championName, errorText, plural, positionLabel, roleIcon } from './format';
import { placePopover } from './popover';
import { deepWardSpots } from './ward-spots';

const STANCES: { id: Stance; label: string }[] = [
  { id: 'farm', label: 'Farmer' },
  { id: 'trade', label: 'Trade' },
  { id: 'allin', label: 'All-in' },
];

type Spot = 'from' | 'to';

function SpotChoice({ value, onPick, onlyFrom }: { value: Spot | null; onPick: (s: Spot) => void; onlyFrom?: boolean }) {
  return (
    <div class="seg indent">
      <button class={value === 'from' ? 'on' : ''} onClick={() => onPick('from')}>Départ</button>
      <button class={value === 'to' ? 'on' : ''} disabled={onlyFrom} onClick={() => onPick('to')}>Arrivée</button>
    </div>
  );
}

/** Round-1 deep ward spots (enemy Blue Buff, Raptors) for the jungler. */
function DeepWardChoice(
  { data, spots, value, onPick }: { data: GameData; spots: string[]; value: string | null; onPick: (p: string) => void },
) {
  return (
    <div class="seg indent">
      {spots.map((p) => (
        <button key={p} class={value === p ? 'on' : ''} onClick={() => onPick(p)}>{positionLabel(data, p)}</button>
      ))}
    </div>
  );
}

/**
 * The selected pawn's actions, floating next to it inside the map box (its offset parent).
 * `anchor` (the pawn) and `avoid` (positions it should leave clickable) are shares (0..1) of the map's drawing.
 */
export function ActionsPanel(
  { store, anchor, avoid }: { store: Store; anchor: { x: number; y: number }; avoid: { x: number; y: number }[] },
) {
  const [error, setError] = useState<{ champion: string; text: string } | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const view = store.view.value;
  const id = store.screen.value === 'orders' ? store.selected.value : null;
  const c = view?.allies.find((x) => x.id === id) ?? null;

  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    const svg = box?.querySelector('svg');
    if (!el || !box || !svg) return;
    const b = box.getBoundingClientRect();
    const m = svg.getBoundingClientRect();
    const px = (p: { x: number; y: number }) => ({ x: m.left - b.left + p.x * m.width, y: m.top - b.top + p.y * m.height });
    const next = placePopover(
      px(anchor),
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: box.clientWidth, height: box.clientHeight },
      avoid.map(px),
    );
    if (!at || Math.abs(at.left - next.left) > 0.5 || Math.abs(at.top - next.top) > 0.5) setAt(next);
  });

  if (!c) return null;

  const run = (fn: () => void) => {
    try {
      fn();
      setError(null);
    } catch (err) {
      setError({ champion: c.id, text: errorText(err) });
    }
  };

  return (
    <div
      ref={ref}
      class="popover"
      style={at ? { left: `${at.left}px`, top: `${at.top}px` } : { visibility: 'hidden' }}
    >
      <button class="close" title="Fermer" onClick={() => store.select(null)}>×</button>
      <ChampionActions store={store} c={c} order={store.pending.value[c.id]} run={run} />
      {error?.champion === c.id && <div class="error">{error.text}</div>}
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
  const wardSpot: Spot | null = ward === 'to' ? 'to' : ward === 'from' ? 'from' : null;
  const deepSpots = recall ? [] : deepWardSpots(data, c, store.view.value?.round ?? 0);
  const canUnward = data.rules.wards.unwardRoles.includes(c.role);
  const target = data.graph.positions[move?.to ?? c.position];
  const heraldTarget = c.hasHerald && target?.kind === 'tower' && target.side !== c.side;
  const stance = (move ?? recall)?.stance ?? c.stance;
  const stepThenRecall = recall?.to !== undefined || (move !== null && data.graph.distance(c.position, move.to) === 1);

  return (
    <>
      {header}
      <div class="note">
        Portée : {plural(moves, 'mouvement')}. Clique une position allumée.
      </div>
      {c.role !== 'jungle' && (
        <div class="seg stance" title="Attitude en lane, gardée d'un round à l'autre">
          {STANCES.map((s) => (
            <button key={s.id} class={stance === s.id ? 'on' : ''} onClick={() => run(() => store.setStance(c.id, s.id))}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div class="opt">
        <label>
          <input
            type="checkbox"
            checked={ward !== undefined}
            onChange={(e) => run(() => store.setWard(c.id, (e.currentTarget as HTMLInputElement).checked ? 'from' : null))}
          />{' '}
          Poser une ward
        </label>
        {ward !== undefined && (
          <SpotChoice value={wardSpot} onlyFrom={!!recall} onPick={(s) => run(() => store.setWard(c.id, s))} />
        )}
        {ward !== undefined && deepSpots.length > 0 && (
          <DeepWardChoice
            data={data}
            spots={deepSpots}
            value={typeof ward === 'object' ? ward.position : null}
            onPick={(position) => run(() => store.setWard(c.id, { position }))}
          />
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
        <button class={`wide${recall ? ' on' : ''}`} onClick={() => run(() => store.setRecall(c.id))}>
          {stepThenRecall ? 'Déplacement puis recall' : 'Recall'}
        </button>
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
