import { useState } from 'preact/hooks';
import type { Lane, Position, Role, Side } from '@lml/data/contracts';
import type { PlayerView } from '@lml/engine/contracts';
import type { Store } from '../store';
import { dotRadius, hitRadius, spawnCountdown, wavePoint } from './map-marks';
import { pawnClick } from './pawn-click';
import {
  championImage,
  championName,
  clock,
  dec,
  errorText,
  kindLabel,
  OBJECTIVE_LABEL,
  plural,
  roleIcon,
} from './format';

const SIZE = 600;

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

function Eye({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} pointer-events="none" class="ward">
      <ellipse rx="6.5" ry="4" fill="#fde68a" stroke="#111" stroke-width="1" />
      <circle r="2" fill="#111" />
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

  // Positions the selected pawn can be ordered to, with the number of moves (spawn points count as 0).
  let reach: Record<string, number> | null = null;
  if (selected?.status === 'alive') reach = store.reachableForSelected();
  else if (selected?.status === 'respawning') {
    reach = Object.fromEntries(store.spawnPointsFor(selected.id).map((id) => [id, 0]));
  }

  const now = store.roundWindow().start;
  const pending = store.pending.value;
  const contactAt = new Set(store.screen.value === 'contacts' ? store.contacts.value.map((c) => c.position) : []);

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
      else parts.push(d === 0 ? 'rester ici' : plural(d, 'mouvement'));
    }
    return parts.join(' · ');
  };

  const countdown = (id: string) => spawnCountdown(view, data, id, now);

  const nodes = Object.values(positions).map((p) => {
    const ok = !reach || reach[p.id] !== undefined;
    const destroyed = p.kind === 'tower' && (view.towers[p.id] ?? 0) <= 0;
    const cleared = p.kind === 'camp' && typeof countdown(p.id) === 'number';
    const cls = `node${reach ? (ok ? ' reach' : ' off') : ''}${destroyed ? ' down' : ''}${cleared ? ' cleared' : ''}`;
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
        onMouseMove={(e: MouseEvent) => setTip({ text: tipText(p), x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTip(null)}
      />
    );
    return <g key={p.id} class={`mpos${reach && ok ? ' act' : ''}`}>{dot}{hit}</g>;
  });

  // Countdown before each pit, scuttle and own camp spawns, or that it is up.
  const timers = Object.values(positions).map((p) => {
    const left = countdown(p.id);
    if (left === null) return null;
    const pit = p.kind === 'pit' ? view.pits[p.id as 'baron-pit' | 'dragon-pit'] : null;
    const text = left !== 'up' ? clock(left) : pit?.objective ? OBJECTIVE_LABEL[pit.objective] : 'en vie';
    return (
      <text key={p.id} class={`timer${left === 'up' ? ' live' : ''}`} x={p.x + dotRadius(p) + 4} y={p.y + 4} text-anchor="start">
        {text}
      </text>
    );
  });

  // One diamond per lane where its wave is, in the colour of the side pushing it (grey in the middle).
  const waves = (['top', 'mid', 'bot'] as Lane[]).map((lane) => {
    const { x, y } = wavePoint(view, data, lane);
    const w = view.waves[lane];
    const fill = w === 0 ? '#e5e7eb' : w < 0 ? '#ef4444' : '#3b82f6';
    return (
      <g key={lane} class="wave" transform={`translate(${x} ${y})`}>
        <polygon points="0,-8 7,0 0,8 -7,0" fill={fill} stroke="#111" stroke-width="1.5" />
      </g>
    );
  });

  const arrows = view.allies.flatMap((c) => {
    const o = pending[c.id];
    if (!o || o.kind === 'recall') return [];
    const from = o.kind === 'spawn' ? `base-${c.side}` : c.position;
    if (o.to === from) return [];
    const path = [from, ...(o.kind === 'move' && o.via ? [o.via] : []), o.to].map((id) => positions[id]);
    if (path.some((p) => !p)) return [];
    const points = path.map((p) => `${p!.x},${p!.y}`).join(' ');
    return [<polyline key={c.id} class="arrow" points={points} marker-end="url(#arr)" />];
  });

  const pawns = pawnsOf(view);
  const byPosition = new Map<string, Pawn[]>();
  for (const pawn of pawns) byPosition.set(pawn.position, [...(byPosition.get(pawn.position) ?? []), pawn]);
  const pawnNodes = [...pawns].sort((a, b) => Number(a.ally) - Number(b.ally)).map((pawn) => {
    const p = positions[pawn.position];
    if (!p) return null;
    const group = byPosition.get(pawn.position)!;
    const i = group.indexOf(pawn);
    const x = p.x + (i - (group.length - 1) / 2) * 42;
    const y = p.y;
    const name = championName(data, pawn.id);
    const clip = `clip-${pawn.id}`;
    const isSel = selected?.id === pawn.id;
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
          setTip({ text: `${name}${pawn.away ? ' · en base' : ''}`, x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTip(null)}
      >
        <rect class="hit" x={x - 20} y={y - 34} width={40} height={64} fill="transparent" />
        <clipPath id={clip}><circle cx={x} cy={y} r={12} /></clipPath>
        <circle class="body" cx={x} cy={y} r={13} fill={pawn.side === 'blue' ? '#1d4ed8' : '#b91c1c'} stroke={pawn.side === 'blue' ? '#93c5fd' : '#fca5a5'} stroke-width={2} />
        <image href={championImage(data, pawn.id)} x={x - 12} y={y - 12} width={24} height={24} clip-path={`url(#${clip})`} />
        <image href={roleIcon(pawn.role)} x={x - 9} y={y - 33} width={18} height={18} />
        <text x={x} y={y + 25} text-anchor="middle" class="pname">{name}</text>
      </g>
    );
  });

  const base = (side: Side) => positions[`base-${side}`];
  return (
    <div class="mapbox">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} onClick={() => ordering && store.select(null)}>
        <Defs />
        <rect width={SIZE} height={SIZE} fill="#2b3428" />
        <image href="./assets/minimap.png" width={SIZE} height={SIZE} filter="url(#floor)" />
        <image href="./assets/minimap.png" width={SIZE} height={SIZE} filter="url(#walls)" />
        <polygon points={view.side === 'blue' ? '0,0 600,0 600,600' : '0,0 0,600 600,600'} fill="#000" opacity=".22" pointer-events="none" />
        {base('blue') && <Nexus p={base('blue')!} side="blue" />}
        {base('red') && <Nexus p={base('red')!} side="red" />}
        <g>{nodes}</g>
        <g pointer-events="none">{timers}</g>
        <g pointer-events="none">{waves}</g>
        <g>
          {view.wards.map((w, i) => {
            const p = positions[w.position];
            return p ? <Eye key={`${w.position}-${i}`} x={p.x + 11} y={p.y - 11} /> : null;
          })}
        </g>
        <g pointer-events="none">
          {[...contactAt].map((id) => {
            const p = positions[id];
            return p ? <circle key={id} class="contact-ring" cx={p.x} cy={p.y} r={22} /> : null;
          })}
        </g>
        <g pointer-events="none">{arrows}</g>
        <g>{pawnNodes}</g>
      </svg>
      {tip && (
        <div class="tip" style={{ left: `${tip.x + 12}px`, top: `${tip.y + 12}px` }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
