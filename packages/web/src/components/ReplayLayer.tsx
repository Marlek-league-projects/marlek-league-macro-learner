import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Store } from '../store';
import { buildReplay, parseReplayAt, REPLAY_MS, stepWindow, tokensAt, type ReplayToken } from '../replay';
import { championImage, championName, roleIcon } from './format';

const SPREAD = 42;

/** Plays the last round on the map: tokens slide, fights flash, the dead fade out, labels pop. */
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
    return { x: p.x + (group.indexOf(tok) - (group.length - 1) / 2) * SPREAD, y: p.y };
  };

  const marks = steps.flatMap((s, i) => {
    if (s.kind === 'move') return [];
    const p = positions[s.position];
    const [a, b] = stepWindow(steps, i);
    if (!p || t < a) return [];
    const k = Math.min(1, (t - a) / (b - a));
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
      {tokens.filter((x) => positions[x.from] && positions[x.to]).sort((a, b) => Number(a.ally) - Number(b.ally)).map((tok) => {
        const a = spot(tok.from, tok);
        const b = spot(tok.to, tok);
        const x = a.x + (b.x - a.x) * tok.f;
        const y = a.y + (b.y - a.y) * tok.f;
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
