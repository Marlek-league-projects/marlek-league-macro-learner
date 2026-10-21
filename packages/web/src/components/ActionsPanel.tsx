import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ChampionState, Order, Stance } from '@lml/engine/contracts';
import type { GameData } from '@lml/data/contracts';
import type { Store } from '../store';
import { championName, errorText, plural, positionLabel, roleIcon } from './format';
import { clampInside, dragSpotUsable, placePopover, visibleRegion } from './popover';
import { deepWardSpots } from './ward-spots';

const STANCES: { id: Stance; label: string }[] = [
  { id: 'farm', label: 'Farmer' },
  { id: 'push', label: 'Push' },
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
 * Opens on the side covering the fewest `avoid` points; its title bar drags it (kept in the store for the
 * session, double-click puts it back next to the pawn). It always stays inside the map box and the viewport.
 */
export function ActionsPanel(
  { store, anchor, avoid }: { store: Store; anchor: { x: number; y: number }; avoid: { x: number; y: number }[] },
) {
  const [error, setError] = useState<{ champion: string; text: string } | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; left: number; top: number } | null>(null);
  const view = store.view.value;
  const id = store.screen.value === 'orders' ? store.selected.value : null;
  const c = view?.allies.find((x) => x.id === id) ?? null;
  const dragged = store.panelAt.value;

  /** The panel, its map box, the box's size and the part of the box inside the viewport (box px). */
  const frame = () => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return null;
    const b = box.getBoundingClientRect();
    const size = { width: box.clientWidth, height: box.clientHeight };
    const region = visibleRegion({ x: b.left, y: b.top }, size, { width: window.innerWidth, height: window.innerHeight });
    return { box, b, size, region, pop: { width: el.offsetWidth, height: el.offsetHeight } };
  };

  const place = () => {
    const f = frame();
    const svg = f?.box.querySelector('svg');
    if (!f || !svg) return;
    const m = svg.getBoundingClientRect();
    const px = (p: { x: number; y: number }) => ({ x: m.left - f.b.left + p.x * m.width, y: m.top - f.b.top + p.y * m.height });
    const spots = avoid.map(px);
    let next = dragged ? clampInside({ left: dragged.x * f.size.width, top: dragged.y * f.size.height }, f.pop, f.region) : null;
    // The remembered spot is for the last pawn: leave it when it hides this pawn or most of its moves.
    if (!next || !dragSpotUsable(next, f.pop, px(anchor), spots)) {
      next = clampInside(placePopover(px(anchor), f.pop, f.region, spots), f.pop, f.region);
    }
    setAt((cur) => (cur && Math.abs(cur.left - next!.left) <= 0.5 && Math.abs(cur.top - next!.top) <= 0.5 ? cur : next));
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  useLayoutEffect(place);

  // Keep the panel on screen when the window is resized or scrolled.
  useEffect(() => {
    const again = () => placeRef.current();
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    return () => {
      window.removeEventListener('resize', again);
      window.removeEventListener('scroll', again, true);
    };
  }, []);

  // The panel can vanish mid-drag (round confirmed, pawn deselected): no release would then clear the flag.
  useEffect(() => () => {
    store.panelDragging.value = false;
  }, [store]);

  if (!c) return null;

  const run = (fn: () => void) => {
    try {
      fn();
      setError(null);
    } catch (err) {
      setError({ champion: c.id, text: errorText(err) });
    }
  };

  const onDown = (e: PointerEvent) => {
    if (!at || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, left: at.left, top: at.top };
    store.panelDragging.value = true;
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    const f = frame();
    if (!d || d.pointer !== e.pointerId || !f) return;
    const next = clampInside({ left: d.left + e.clientX - d.x, top: d.top + e.clientY - d.y }, f.pop, f.region);
    store.panelAt.value = { x: next.left / f.size.width, y: next.top / f.size.height };
  };
  const onUp = (e: PointerEvent) => {
    if (drag.current?.pointer !== e.pointerId) return;
    drag.current = null;
    // Still "dragging" for the click this release may fire, so the map ignores it.
    setTimeout(() => (store.panelDragging.value = false), 0);
  };
  const onLost = (e: PointerEvent) => {
    if (drag.current?.pointer !== e.pointerId) return;
    drag.current = null;
    store.panelDragging.value = false;
  };

  return (
    <div
      ref={ref}
      class={`popover${store.panelDragging.value ? ' dragging' : ''}`}
      style={at ? { left: `${at.left}px`, top: `${at.top}px` } : { visibility: 'hidden' }}
    >
      <div
        class="ptitle"
        title="Glisser pour déplacer · double-clic : replacer près du pion"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onLost}
        onLostPointerCapture={onLost}
        onDblClick={() => (store.panelAt.value = null)}
      >
        <img class="ri" src={roleIcon(c.role)} alt="" />
        <strong>{championName(store.data, c.id)}</strong>
        {c.status === 'alive' && <span class="muted">· {positionLabel(store.data, c.position)}</span>}
        <button class="close" title="Fermer" onClick={() => store.select(null)}>×</button>
      </div>
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

  if (c.status === 'dead') {
    return <div class="neg">Mort (retour round {c.respawnRound})</div>;
  }

  if (c.status === 'respawning') {
    const points = store.spawnPointsFor(c.id);
    const chosen = order?.kind === 'spawn' ? order.to : points[0];
    return (
      <>
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
  const unward = move?.unward ?? recall?.unward;
  const canUnward = data.rules.wards.unwardRoles.includes(c.role);
  const target = data.graph.positions[move?.to ?? c.position];
  const heraldTarget = c.hasHerald && target?.kind === 'tower' && target.side !== c.side;
  const stance = (move ?? recall)?.stance ?? c.stance;
  const stepThenRecall = recall?.to !== undefined || (move !== null && data.graph.distance(c.position, move.to) === 1);

  return (
    <>
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
          <SpotChoice value={wardSpot} onlyFrom={recall !== null && recall.to === undefined} onPick={(s) => run(() => store.setWard(c.id, s))} />
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
                checked={unward !== undefined}
                onChange={(e) => run(() => store.setUnward(c.id, (e.currentTarget as HTMLInputElement).checked ? 'from' : null))}
              />{' '}
              Unward
            </label>
            {unward !== undefined && (
              <SpotChoice value={unward} onlyFrom={recall !== null && recall.to === undefined} onPick={(s) => run(() => store.setUnward(c.id, s))} />
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
