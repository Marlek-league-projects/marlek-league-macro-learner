import { useState } from 'preact/hooks';
import type { Lane, Position, Role, Side } from '@lml/data/contracts';
import type { PlayerView } from '@lml/engine/contracts';
import type { Store } from '../store';
import { wardTooltip } from './wards';
import { ActionsPanel } from './ActionsPanel';
import { ContactsOverlay } from './ContactPrompt';
import { ObjectivePrompt } from './ObjectivePrompt';
import { contactDock } from './popover';
import {
  ARRIVAL_ONLY_TIP,
  dotRadius,
  hitRadius,
  objectivePromptEntries,
  type PendingMove,
  PAWN_SPREAD,
  pressureDirection,
  rangeRing,
  pitTimer,
  spawnCountdown,
  wavePoint,
} from './map-marks';
import { hpColor, type Hud, hudText, hudTop, hudValues } from './hud';
import { nodeClickKeepsSelection, pawnClick, pawnHitPassesThrough } from './pawn-click';
import { ReplayLayer } from './ReplayLayer';
import {
  championImage,
  championName,
  clock,
  dec,
  errorText,
  kindLabel,
  plural,
  recallIcon,
  roleIcon,
} from './format';

const SIZE = 600;

const SIDE_COLOR: Record<Side, string> = { blue: '#3b82f6', red: '#ef4444' };

function nodeColor(p: Position): string {
  if (p.kind === 'pit') return p.pit === 'baron' ? '#a855f7' : '#f97316';
  if (p.kind === 'scuttle') return '#38bdf8';
  if (p.kind === 'camp') return '#22c55e';
  if (p.side === 'blue') return '#3b82f6';
  if (p.side === 'red') return '#ef4444';
  return '#9ca3af';
}

interface Pawn {
  id: string;
  role: Role;
  side: Side;
  position: string;
  ally: boolean;
  away: boolean;
}

interface Tip {
  text: string;
  x: number;
  y: number;
}

/** Who stands where: alive allies, respawning allies at their base, enemies only while visible. */
function pawnsOf(view: PlayerView): Pawn[] {
  const enemy: Side = view.side === 'blue' ? 'red' : 'blue';
  const out: Pawn[] = [];
  for (const c of view.allies) {
    if (c.status === 'dead') continue;
    const away = c.status === 'respawning';
    out.push({ id: c.id, role: c.role, side: c.side, position: away ? `base-${c.side}` : c.position, ally: true, away });
  }
  for (const e of view.enemies) {
    if (!e.visible || !e.position) continue;
    out.push({ id: e.id, role: e.role, side: enemy, position: e.position, ally: false, away: false });
  }
  return out;
}

function Defs() {
  return (
    <defs>
      <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0,0 L10,5 L0,10 z" fill="#fde047" />
      </marker>
      <filter id="floor">
        <feColorMatrix type="matrix" values=".42 0 0 0 .02  0 .5 0 0 .03  0 0 .45 0 .02  0 0 0 1 0" />
      </filter>
      <filter id="walls" x="-5%" y="-5%" width="110%" height="110%">
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1 1" result="m" />
        <feFlood flood-color="#5f6d58" result="c" />
        <feComposite in="c" in2="m" operator="in" result="w" />
        <feGaussianBlur in="m" stdDeviation="1.6" result="b" />
        <feSpecularLighting in="b" surfaceScale="4" specularConstant=".55" specularExponent="18" lighting-color="#f5f5dc" result="spec">
          <feDistantLight azimuth="225" elevation="40" />
        </feSpecularLighting>
        <feComposite in="spec" in2="m" operator="in" result="hl" />
        <feOffset in="m" dx="2" dy="3" result="o" />
        <feGaussianBlur in="o" stdDeviation="2" result="ob" />
        <feFlood flood-color="#000" flood-opacity=".75" />
        <feComposite in2="ob" operator="in" result="sh" />
        <feMerge>
          <feMergeNode in="sh" />
          <feMergeNode in="w" />
          <feMergeNode in="hl" />
        </feMerge>
      </filter>
      <radialGradient id="glow-blue"><stop offset="0" stop-color="#60a5fa" stop-opacity=".8" /><stop offset="1" stop-color="#60a5fa" stop-opacity="0" /></radialGradient>
      <radialGradient id="glow-red"><stop offset="0" stop-color="#f87171" stop-opacity=".8" /><stop offset="1" stop-color="#f87171" stop-opacity="0" /></radialGradient>
      <linearGradient id="crys-blue" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dbeafe" /><stop offset=".5" stop-color="#3b82f6" /><stop offset="1" stop-color="#1e3a8a" /></linearGradient>
      <linearGradient id="crys-red" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fee2e2" /><stop offset=".5" stop-color="#ef4444" /><stop offset="1" stop-color="#7f1d1d" /></linearGradient>
    </defs>
  );
}

function Nexus({ p, side }: { p: Position; side: Side }) {
  return (
    <g transform={`translate(${p.x} ${p.y})`} pointer-events="none">
      <circle r="26" fill={`url(#glow-${side})`} />
      <polygon points="0,-14 12,-7 12,7 0,14 -12,7 -12,-7" fill="#1f2937" stroke="#94a3b8" stroke-width="1.5" />
      <polygon points="0,-20 8,-4 0,9 -8,-4" fill={`url(#crys-${side})`} stroke="#e2e8f0" stroke-width=".8" />
      <polygon points="0,-20 3,-6 0,2 -3,-6" fill="#fff" opacity=".45" />
    </g>
  );
}

/** League's recall icon in a round frame, centred on (x, y). */
function RecallBadge({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <g class="recall-badge" pointer-events="none">
      <title>Recall</title>
      <circle cx={x} cy={y} r={size / 2 + 1.5} fill="#0b1220" stroke="#38bdf8" stroke-width={1.5} />
      <image href={recallIcon()} x={x - size / 2} y={y - size / 2} width={size} height={size} />
    </g>
  );
}

function Eye({ x, y, left, tip }: { x: number; y: number; left: number; tip: string }) {
  return (
    <g transform={`translate(${x} ${y})`} class="ward">
      <title>{tip}</title>
      <ellipse rx="6.5" ry="4" fill="#fde68a" stroke="#111" stroke-width="1" />
      <circle r="2" fill="#111" />
      <circle cx="7" cy="-5" r="4.5" fill="#111" stroke="#fde68a" stroke-width=".8" />
      <text x="7" y="-2.6" text-anchor="middle" class="ward-n">{left}</text>
    </g>
  );
}

/**
 * A token's HUD: level and power, HP bar, XP bar (allies only). Stacked above the role icon, or below the name
 * when the token stands too close to the map's top edge for it to fit.
 */
function PawnHud({ x, y, hud }: { x: number; y: number; hud: Hud }) {
  const w = 28;
  const top = hudTop(y);
  return (
    <g class="hud" pointer-events="none">
      <text x={x} y={top + 8} text-anchor="middle">
        niv {hud.level} · <tspan class="pow">⚔ {hud.power}</tspan>
      </text>
      <rect x={x - w / 2} y={top + 10} width={w} height={4.5} rx={1} fill="#0b0f14" stroke="#000" stroke-width={0.8} />
      <rect x={x - w / 2 + 0.5} y={top + 10.5} width={(w - 1) * hud.hp} height={3.5} rx={0.8} fill={hpColor(hud.hp)} />
      {hud.xp !== null && (
        <>
          <rect x={x - w / 2} y={top + 15.5} width={w} height={2.5} fill="#0b0f14" />
          <rect x={x - w / 2} y={top + 15.5} width={w * hud.xp} height={2.5} fill="#a78bfa" />
        </>
      )}
    </g>
  );
}

export function MapView({ store }: { store: Store }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const view = store.view.value;
  if (!view) return null;
  const { data } = store;
  const { positions } = data.graph;
  const ordering = store.screen.value === 'orders';
  const selectedId = ordering ? store.selected.value : null;
  const selected = view.allies.find((c) => c.id === selectedId) ?? null;

  // Positions the selected pawn can be ordered to, with the number of moves (a respawning one walks from its base).
  const reach: Record<string, number> | null = selected && selected.status !== 'dead' ? store.reachableForSelected() : null;

  const roundWin = store.roundWindow();
  const now = roundWin.start;
  const pending = store.pending.value;
  const replayable = store.screen.value === 'review' || store.screen.value === 'over';
  const replaying = replayable && store.replaying.value && store.previousView.value !== null;
  // Every zone position where the contact's champions arrived gets a ring.
  const contactAt = new Set(
    store.screen.value === 'contacts' ? store.contacts.value.flatMap((c) => c.positions) : [],
  );
  const pendingMoves: Record<string, PendingMove> = {};
  for (const [id, o] of Object.entries(pending)) {
    const acts = store.pendingMoveActs(id);
    if (o.kind === 'move' && acts !== null) pendingMoves[id] = { to: o.to, acts };
  }
  const objectiveEntries = ordering ? objectivePromptEntries(view, data, roundWin, store.objectivePromptsClosed.value, pendingMoves) : [];
  /** Act or arrival-only ring of a position for the selected token. */
  const ring = (id: string) => (reach && selected ? rangeRing(reach[id], (d) => store.canAct(d, selected.id)) : null);

  const order = (to: string) => {
    if (!selected) return;
    try {
      if (selected.status === 'respawning') store.setSpawn(selected.id, to);
      else store.setMove(selected.id, to);
    } catch (err) {
      setTip({ text: errorText(err), x: tip?.x ?? 0, y: tip?.y ?? 0 });
    }
  };

  const tipText = (p: Position): string => {
    const parts = [p.label, kindLabel(p)];
    if (p.kind === 'tower') parts.push(`${dec(Math.max(0, view.towers[p.id] ?? 0))} / ${data.rules.towers.hp} PV`);
    if (reach) {
      const d = reach[p.id];
      if (d === undefined) parts.push('hors de portée ce round');
      else if (selected?.status === 'respawning') parts.push('point de réapparition');
      else {
        parts.push(d === 0 ? 'rester ici' : plural(d, 'mouvement'));
        if (ring(p.id) === 'arrive') parts.push(ARRIVAL_ONLY_TIP);
      }
    }
    return parts.join(' · ');
  };

  const countdown = (id: string) => spawnCountdown(view, data, id, now);

  const nodes = Object.values(positions).map((p) => {
    const ok = !reach || reach[p.id] !== undefined;
    const destroyed = p.kind === 'tower' && (view.towers[p.id] ?? 0) <= 0;
    const cleared = p.kind === 'camp' && typeof countdown(p.id) === 'number';
    const kind = ring(p.id);
    const cls = `node${reach ? (kind === 'act' ? ' reach' : kind === 'arrive' ? ' arrive' : ' off') : ''}${destroyed ? ' down' : ''}${cleared ? ' cleared' : ''}`;
    // Unreachable positions get no click circle while a pawn is selected.
    const hit = ok && (
      <circle
        class="hit"
        cx={p.x}
        cy={p.y}
        r={hitRadius(p)}
        fill="transparent"
        onMouseMove={(e: MouseEvent) => setTip({ text: tipText(p), x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTip(null)}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          if (reach) order(p.id);
        }}
      />
    );
    const dot = p.kind !== 'base' && (
      <circle
        class={cls}
        cx={p.x}
        cy={p.y}
        r={dotRadius(p)}
        fill={destroyed || cleared ? '#4b5563' : nodeColor(p)}
        stroke="#111"
        stroke-width={1.5}
        pointer-events={ok ? 'none' : undefined}
        onClick={(e: MouseEvent) => {
          if (nodeClickKeepsSelection(p.id, reach)) e.stopPropagation();
        }}
        onMouseMove={(e: MouseEvent) => setTip({ text: tipText(p), x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTip(null)}
      />
    );
    // Arrival-only: a dashed ring around the dot (the token gets there but cannot act this round).
    const arriveRing = kind === 'arrive' && (
      <circle class="arrive-ring" cx={p.x} cy={p.y} r={dotRadius(p) + 5} pointer-events="none" />
    );
    return <g key={p.id} class={`mpos${reach && ok ? ' act' : ''}`}>{dot}{arriveRing}{hit}</g>;
  });

  const pawns = pawnsOf(view);
  const byPosition = new Map<string, Pawn[]>();
  for (const pawn of pawns) byPosition.set(pawn.position, [...(byPosition.get(pawn.position) ?? []), pawn]);

  // Countdown before each pit, scuttle and own camp spawns, or that it is up (drawn right of any pawns there).
  const timers = Object.values(positions).map((p) => {
    const n = byPosition.get(p.id)?.length ?? 0;
    const reachX = Math.max(dotRadius(p), n > 0 ? ((n - 1) / 2) * PAWN_SPREAD + 14 : 0);
    if (p.kind === 'pit') {
      // Pits name what they count down to with the time left ("Larves 4:30"), and when an up objective leaves ("part dans 7:20").
      const pt = pitTimer(view, data, p.id as 'baron-pit' | 'dragon-pit', now, roundWin.end);
      if (!pt) return null;
      const x = p.x + reachX + 4;
      return (
        <text key={p.id} class={`timer${pt.live ? ' live' : ''}`} x={x} y={pt.until ? p.y - 1 : p.y + 4} text-anchor="start">
          <title>{pt.title}</title>
          {pt.text}
          {pt.until && <tspan class="timer-until" x={x} dy={11}>{pt.until}</tspan>}
        </text>
      );
    }
    const left = countdown(p.id);
    if (left === null) return null;
    const text = left !== 'up' ? clock(left) : 'en vie';
    return (
      <text key={p.id} class={`timer${left === 'up' ? ' live' : ''}`} x={p.x + reachX + 4} y={p.y + 4} text-anchor="start">
        {text}
      </text>
    );
  });

  // One diamond per lane where its wave is, in the colour of the side pushing it (grey in the middle).
  const waves = (['top', 'mid', 'bot'] as Lane[]).map((lane) => {
    const { x, y } = wavePoint(view, data, lane);
    const w = view.waves[lane];
    const fill = w === 0 ? '#e5e7eb' : w < 0 ? '#ef4444' : '#3b82f6';
    // Who has lane pressure (from what the viewer sees): an arrow the way that side pushes.
    const by = view.pressure[lane];
    let arrow = null;
    if (by) {
      const d = pressureDirection(data, lane, by);
      const at = (k: number, side: number) => `${d.x * k - d.y * side},${-12 + d.y * k + d.x * side}`;
      arrow = (
        <polygon class="pressure" points={`${at(20, 0)} ${at(10, 6)} ${at(10, -6)}`} fill={SIDE_COLOR[by]} stroke="#111" stroke-width="1.2" />
      );
    }
    return (
      <g key={lane} class="wave" transform={`translate(${x} ${y})`}>
        <title>{by ? `Pression ${by === view.side ? 'pour toi' : "pour l'adversaire"}` : 'Pas de pression'}</title>
        <polygon points="0,-8 7,0 0,8 -7,0" transform="translate(0 -12)" fill={fill} stroke="#111" stroke-width="1.5" />
        {arrow}
      </g>
    );
  });

  // Pending moves as dashed arrows along the engine's route; a recall's step ends in the recall icon.
  const arrows = view.allies.flatMap((c) => {
    const o = pending[c.id];
    if (!o || o.to === undefined) return [];
    const from = o.kind === 'spawn' ? `base-${c.side}` : c.position;
    if (o.to === from) return [];
    const path = store.routeOf(c.id, o.to).map((id) => positions[id]);
    if (path.length < 2 || path.some((p) => !p)) return [];
    const points = path.map((p) => `${p!.x},${p!.y}`).join(' ');
    if (o.kind !== 'recall') return [<polyline key={c.id} class="arrow" points={points} marker-end="url(#arr)" />];
    const end = path[path.length - 1]!;
    return [
      <g key={c.id} class="recall-arrow">
        <polyline class="arrow" points={points} />
        <RecallBadge x={end.x} y={end.y} size={20} />
      </g>,
    ];
  });

  /** Where a pawn is drawn: pawns sharing a position stand side by side. */
  const pawnPoint = (pawn: Pawn): { x: number; y: number } | null => {
    const p = positions[pawn.position];
    if (!p) return null;
    const group = byPosition.get(pawn.position)!;
    const i = group.indexOf(pawn);
    return { x: p.x + (i - (group.length - 1) / 2) * PAWN_SPREAD, y: p.y };
  };
  // A recall with no step: the icon sits on the token.
  const recallsInPlace = view.allies.flatMap((c) => {
    const o = pending[c.id];
    if (o?.kind !== 'recall' || o.to !== undefined) return [];
    const pawn = pawns.find((x) => x.ally && x.id === c.id);
    const at = pawn && pawnPoint(pawn);
    return at ? [<RecallBadge key={c.id} x={at.x + 10} y={at.y + 10} size={16} />] : [];
  });
  const hud = hudValues(view, data, store.level, store.estimateEnemy);
  const selectedPawn = pawns.find((pawn) => pawn.ally && pawn.id === selected?.id);
  const anchor = selectedPawn ? pawnPoint(selectedPawn) : null;

  const pawnNodes = [...pawns].sort((a, b) => Number(a.ally) - Number(b.ally)).map((pawn) => {
    const at = pawnPoint(pawn);
    if (!at) return null;
    const { x, y } = at;
    const values = hud[pawn.id];
    const name = championName(data, pawn.id);
    const clip = `clip-${pawn.id}`;
    const isSel = selected?.id === pawn.id;
    const passThrough = pawnHitPassesThrough(pawn, selected?.id ?? null, reach);
    return (
      <g
        key={pawn.id}
        class={`pawn${pawn.ally ? ' mine' : ''}${isSel ? ' sel' : ''}${pawn.away ? ' away' : ''}`}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          if (!ordering) return;
          const action = pawnClick(pawn, selected?.id ?? null, reach);
          if (action.kind === 'select') store.select(action.id);
          else if (action.kind === 'order') order(action.to);
        }}
        onMouseMove={(e: MouseEvent) =>
          setTip({ text: `${name}${pawn.away ? ' · en base' : ''}${values ? ` · ${hudText(values, data.rules.health.max)}` : ''}`, x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTip(null)}
      >
        <rect class="hit" x={x - 13} y={y - 33} width={26} height={46} fill="transparent" pointer-events={passThrough ? 'none' : undefined} />
        <clipPath id={clip}><circle cx={x} cy={y} r={12} /></clipPath>
        <circle class="body" cx={x} cy={y} r={13} fill={pawn.side === 'blue' ? '#1d4ed8' : '#b91c1c'} stroke={pawn.side === 'blue' ? '#93c5fd' : '#fca5a5'} stroke-width={2} />
        <image href={championImage(data, pawn.id)} x={x - 12} y={y - 12} width={24} height={24} clip-path={`url(#${clip})`} />
        <image href={roleIcon(pawn.role)} x={x - 9} y={y - 33} width={18} height={18} pointer-events={passThrough ? 'none' : undefined} />
        {values && <PawnHud x={x} y={y} hud={values} />}
        <text x={x} y={y + 25} text-anchor="middle" class="pname">{name}</text>
      </g>
    );
  });

  const base = (side: Side) => positions[`base-${side}`];
  return (
    <div
      class="mapbox"
      onClickCapture={(e: MouseEvent) => {
        // A click ending a drag of the actions panel is not an order.
        if (store.panelDragging.value) e.stopPropagation();
      }}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} onClick={() => ordering && store.select(null)}>
        <Defs />
        <rect width={SIZE} height={SIZE} fill="#2b3428" />
        <image href="./assets/minimap.png" width={SIZE} height={SIZE} filter="url(#floor)" />
        <image href="./assets/minimap.png" width={SIZE} height={SIZE} filter="url(#walls)" />
        <polygon points={view.side === 'blue' ? '0,0 600,0 600,600' : '0,0 0,600 600,600'} fill="#000" opacity=".22" pointer-events="none" />
        {base('blue') && <Nexus p={base('blue')!} side="blue" />}
        {base('red') && <Nexus p={base('red')!} side="red" />}
        <g pointer-events="none">{waves}</g>
        <g>{nodes}</g>
        <g>
          {view.wards.map((w, i) => {
            const p = positions[w.position];
            if (!p) return null;
            const left = store.wardRoundsLeft(w);
            return <Eye key={`${w.position}-${i}`} x={p.x + 11} y={p.y - 11} left={left} tip={wardTooltip(w, left, view.round)} />;
          })}
        </g>
        <g pointer-events="none">
          {[...contactAt].map((id) => {
            const p = positions[id];
            return p ? <circle key={id} class="contact-ring" cx={p.x} cy={p.y} r={22} /> : null;
          })}
        </g>
        <g pointer-events="none">{arrows}</g>
        {replaying ? <ReplayLayer key={store.replayRun.value} store={store} /> : <g>{pawnNodes}</g>}
        {!replaying && <g pointer-events="none">{recallsInPlace}</g>}
        <g pointer-events="none">{timers}</g>
      </svg>
      {ordering && anchor && (
        <ActionsPanel
          store={store}
          anchor={{ x: anchor.x / SIZE, y: anchor.y / SIZE }}
          avoid={Object.keys(reach ?? {}).flatMap((id) => {
            const p = positions[id];
            return p ? [{ x: p.x / SIZE, y: p.y / SIZE }] : [];
          })}
        />
      )}
      {objectiveEntries.length > 0 && (
        <ObjectivePrompt
          store={store}
          entries={objectiveEntries}
          dock={contactDock(objectiveEntries.map((e) => (positions[e.pit]?.y ?? 0) / SIZE))}
        />
      )}
      {contactAt.size > 0 && (
        <ContactsOverlay store={store} dock={contactDock([...contactAt].map((id) => (positions[id]?.y ?? 0) / SIZE))} />
      )}
      {tip && (
        <div class="tip" style={{ left: `${tip.x + 12}px`, top: `${tip.y + 12}px` }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
