import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Store } from '../store';
import { buildReplay, parseReplayAt, REPLAY_MS, stepWindow, tokensAt, type ReplayToken } from '../replay';
import { championImage, championName, recallIcon, roleIcon } from './format';
import { PAWN_SPREAD } from './map-marks';


/**
 * Plays the last round on the map: tokens slide, fights flash, the dead fade out, recalled tokens show the recall
 * icon and fade, wards that saw an enemy pulse with a ghost of it, labels pop.
 */
export function ReplayLayer({ store }: { store: Store }) {
  const before = store.previousView.value;
  const after = store.view.value;
  const events = store.lastEvents.value;
  const steps = useMemo(
    () => (before && after ? buildReplay(before, after, events) : []),
    [before, after, events],
  );
  const [t, setT] = useState(0);

  useEffect(() => {
    const frozen = parseReplayAt(location.search);
    if (frozen !== null) {
      setT(frozen);
      return;
    }
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      store.skipReplay();
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / REPLAY_MS);
      setT(p);
      if (p >= 1) store.skipReplay();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [store]);

  if (!before) return null;
  const { data } = store;
  const { positions } = data.graph;
  const tokens = tokensAt(before, steps, t).filter((x) => x.opacity > 0);

  // Tokens sharing a position stand side by side, as on the map.
  const members = new Map<string, ReplayToken[]>();
  for (const tok of tokens) {
    for (const node of new Set([tok.from, tok.to])) members.set(node, [...(members.get(node) ?? []), tok]);
  }
  const spot = (node: string, tok: ReplayToken) => {
    const p = positions[node] ?? { x: 0, y: 0 };
    const group = members.get(node)!;
    return { x: p.x + (group.indexOf(tok) - (group.length - 1) / 2) * PAWN_SPREAD, y: p.y };
  };

  const drawn = tokens.filter((x) => positions[x.from] && positions[x.to]);
  const at = new Map<string, { x: number; y: number }>();
  for (const tok of drawn) {
    const a = spot(tok.from, tok);
    const b = spot(tok.to, tok);
    at.set(tok.champion, { x: a.x + (b.x - a.x) * tok.f, y: a.y + (b.y - a.y) * tok.f });
  }

  const marks = steps.flatMap((s, i) => {
    if (s.kind === 'move') return [];
    const p = positions[s.position];
    const [a, b] = stepWindow(steps, i);
    if (!p || t < a) return [];
    const k = Math.min(1, (t - a) / (b - a));
    if (s.kind === 'recall') {
      // On the token when it is drawn, else (an enemy seen only recalling) on the recall position.
      const c = at.get(s.champion) ?? p;
      if (t >= b) return [];
      return [
        <g key={i} class="replay-recall">
          <circle cx={c.x} cy={c.y} r={12} fill="#0b1220" stroke="#38bdf8" stroke-width={2} />
          <image href={recallIcon()} x={c.x - 11} y={c.y - 11} width={22} height={22} />
        </g>,
      ];
    }
    if (s.kind === 'spotted') {
      if (t > b) return [];
      const pulse = Math.sin(Math.PI * k);
      const ex = p.x + 11;
      const ey = p.y - 11;
      const clip = `sclip-${i}`;
      return [
        <g key={i} class="replay-spot">
          <circle class="spot-pulse" cx={ex} cy={ey} r={6 + 10 * k} opacity={pulse} />
          <ellipse cx={ex} cy={ey} rx={6.5 * (1 + 0.3 * pulse)} ry={4 * (1 + 0.3 * pulse)} fill="#fde68a" stroke="#111" stroke-width={1} />
          <circle cx={ex} cy={ey} r={2} fill="#111" />
          <g class="ghost" opacity={0.75 * pulse}>
            <clipPath id={clip}><circle cx={p.x} cy={p.y} r={12} /></clipPath>
            <circle cx={p.x} cy={p.y} r={13} fill={before.side === 'blue' ? '#b91c1c' : '#1d4ed8'} stroke={before.side === 'blue' ? '#fca5a5' : '#93c5fd'} stroke-width={2} stroke-dasharray="3 2" />
            <image href={championImage(data, s.champion)} x={p.x - 12} y={p.y - 12} width={24} height={24} clip-path={`url(#${clip})`} />
          </g>
        </g>,
      ];
    }
    if (s.kind === 'fight') {
      if (t > b) return [];
      return [<circle key={i} class="replay-flash" cx={p.x} cy={p.y} r={18 + 16 * k} opacity={Math.sin(Math.PI * k)} />];
    }
    const scale = 0.6 + 0.4 * Math.min(1, k * 2);
    return [
      <g key={i} class={`replay-label ${s.kind}`} transform={`translate(${p.x} ${p.y - 30}) scale(${scale})`}>
        <text text-anchor="middle">{s.kind === 'death' ? `✕ ${s.label}` : s.label}</text>
      </g>,
    ];
  });

  return (
    <g class="replay" pointer-events="none">
      {drawn.sort((a, b) => Number(a.ally) - Number(b.ally)).map((tok) => {
        const { x, y } = at.get(tok.champion)!;
        const clip = `rclip-${tok.champion}`;
        return (
          <g key={tok.champion} class={`pawn${tok.ally ? ' mine' : ''}`} opacity={tok.opacity}>
            <clipPath id={clip}><circle cx={x} cy={y} r={12} /></clipPath>
            <circle class="body" cx={x} cy={y} r={13} fill={tok.side === 'blue' ? '#1d4ed8' : '#b91c1c'} stroke={tok.side === 'blue' ? '#93c5fd' : '#fca5a5'} stroke-width={2} />
            <image href={championImage(data, tok.champion)} x={x - 12} y={y - 12} width={24} height={24} clip-path={`url(#${clip})`} />
            <image href={roleIcon(tok.role)} x={x - 9} y={y - 33} width={18} height={18} />
            <text x={x} y={y + 25} text-anchor="middle" class="pname">{championName(data, tok.champion)}</text>
          </g>
        );
      })}
      {marks}
    </g>
  );
}
