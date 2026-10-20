// Round replay: a pure timeline built from the views around a round and its fog-filtered events.
import type { Role, Side } from '@lml/data/contracts';
import type { GameEvent, PlayerView } from '@lml/engine/contracts';
import { dec, OBJECTIVE_LABEL } from './components/format';

export type ReplayStep =
  | { kind: 'move'; champion: string; from: string; to: string }
  | { kind: 'fight' | 'objective' | 'camp' | 'tower'; position: string; label: string }
  | { kind: 'death'; position: string; label: string; champion: string };

/** One champion token at a moment of the replay: `f` of the way from `from` to `to`. */
export interface ReplayToken {
  champion: string;
  role: Role;
  side: Side;
  ally: boolean;
  from: string;
  to: string;
  f: number;
  opacity: number;
}

/** Replay length in milliseconds, played once when the review screen opens. */
export const REPLAY_MS = 2000;

// Fractions of the replay: moves slide, fights flash, then retreats and deaths, then labels pop.
const MOVE_WINDOWS: Array<[number, number]> = [[0, 0.4], [0.6, 0.8], [0.8, 0.95]];
const FIGHT_WINDOW: [number, number] = [0.4, 0.6];
const DEATH_WINDOW: [number, number] = [0.6, 0.8];
const LABEL_WINDOW: [number, number] = [0.8, 1];

/** Where each champion stands on the map in a view (null: not on it, or not seen). */
function startPositions(v: PlayerView): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const c of v.allies) {
    out.set(c.id, c.status === 'dead' ? null : c.status === 'respawning' ? `base-${c.side}` : c.position);
  }
  for (const e of v.enemies) out.set(e.id, e.visible ? e.position : null);
  return out;
}

const isAlly = (v: PlayerView, id: string): boolean => v.allies.some((c) => c.id === id);
const enemySeen = (v: PlayerView, id: string): boolean => v.enemies.some((e) => e.id === id && e.visible);

/**
 * The replay of one round, in play order: first moves, fights, retreats (flights and drawn fights going
 * back) with deaths, then objective, camp and tower labels. Enemies move only while seen before or after.
 */
export function buildReplay(before: PlayerView, after: PlayerView, events: GameEvent[]): ReplayStep[] {
  const shown = (id: string): boolean => isAlly(before, id) || enemySeen(before, id) || enemySeen(after, id);
  const at = startPositions(before);
  const moves = new Map<string, number>();
  const ranked: Array<{ rank: number; step: ReplayStep }> = [];
  const move = (champion: string, from: string, to: string): void => {
    const n = moves.get(champion) ?? 0;
    moves.set(champion, n + 1);
    at.set(champion, to);
    ranked.push({ rank: n === 0 ? 0 : 2, step: { kind: 'move', champion, from, to } });
  };

  for (const e of events) {
    switch (e.type) {
      case 'moved':
        if (shown(e.champion)) move(e.champion, e.from, e.to);
        break;
      case 'fled': {
        const from = at.get(e.champion);
        if (shown(e.champion) && from && from !== e.to) move(e.champion, from, e.to);
        break;
      }
      case 'fight':
        ranked.push({ rank: 1, step: { kind: 'fight', position: e.position, label: 'Combat' } });
        break;
      case 'death':
        ranked.push({ rank: 2, step: { kind: 'death', position: e.position, label: 'Mort', champion: e.champion } });
        break;
      case 'objectiveTaken':
        ranked.push({ rank: 3, step: { kind: 'objective', position: e.position, label: OBJECTIVE_LABEL[e.objective] } });
        break;
      case 'campCleared':
        ranked.push({ rank: 3, step: { kind: 'camp', position: e.camp, label: 'Camp nettoyé' } });
        break;
      case 'towerDamage':
        ranked.push({
          rank: 3,
          step: { kind: 'tower', position: e.tower, label: e.destroyed ? 'Tour détruite' : `−${dec(e.damage)} PV` },
        });
        break;
    }
  }

  // Fighters of a drawn fight go back without an event: slide the seen ones to where they ended.
  const end = startPositions(after);
  for (const c of after.allies) {
    const last = at.get(c.id);
    if (c.status === 'alive' && last && last !== c.position) move(c.id, last, c.position);
  }
  for (const e of after.enemies) {
    const last = at.get(e.id);
    const now = end.get(e.id);
    if (now && last && last !== now) move(e.id, last, now);
  }

  return ranked.map((r, i) => ({ ...r, i })).sort((a, b) => a.rank - b.rank || a.i - b.i).map((r) => r.step);
}

/** The [start, end] fractions of the replay over which step `i` plays. */
export function stepWindow(steps: ReplayStep[], i: number): [number, number] {
  const step = steps[i]!;
  switch (step.kind) {
    case 'move': {
      const k = steps.slice(0, i).filter((s) => s.kind === 'move' && s.champion === step.champion).length;
      return MOVE_WINDOWS[Math.min(k, MOVE_WINDOWS.length - 1)]!;
    }
    case 'fight':
      return FIGHT_WINDOW;
    case 'death':
      return DEATH_WINDOW;
    default:
      return LABEL_WINDOW;
  }
}

const progress = ([a, b]: [number, number], t: number): number => Math.min(1, Math.max(0, (t - a) / (b - a)));

/** Every token on the map at fraction `t` of the replay, starting from the `before` view. */
export function tokensAt(before: PlayerView, steps: ReplayStep[], t: number): ReplayToken[] {
  const enemySide: Side = before.side === 'blue' ? 'red' : 'blue';
  const who = new Map<string, { role: Role; side: Side; ally: boolean }>();
  for (const c of before.allies) who.set(c.id, { role: c.role, side: c.side, ally: true });
  for (const e of before.enemies) who.set(e.id, { role: e.role, side: enemySide, ally: false });
  const start = startPositions(before);

  const out: ReplayToken[] = [];
  for (const [champion, info] of who) {
    let pos = start.get(champion) ?? null;
    let from = pos;
    let to = pos;
    let f = 0;
    let opacity = 1;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      if (s.kind === 'move' && s.champion === champion) {
        const w = stepWindow(steps, i);
        if (t < w[0] || (t === w[0] && pos !== null)) break;
        if (t < w[1]) {
          from = s.from;
          to = s.to;
          f = progress(w, t);
          pos = null;
          break;
        }
        pos = from = to = s.to;
      }
    }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      if (s.kind === 'death' && s.champion === champion) opacity = 1 - progress(stepWindow(steps, i), t);
    }
    if (from === null || to === null) {
      // Unseen at the start: shows up at the start of its first seen move.
      const first = steps.findIndex((s) => s.kind === 'move' && s.champion === champion);
      if (first < 0 || t < stepWindow(steps, first)[0]) continue;
      const s = steps[first] as Extract<ReplayStep, { kind: 'move' }>;
      from = to = s.from;
    }
    out.push({ champion, ...info, from, to, f, opacity });
  }
  return out;
}

/** Dev-only `?replayAt=0.5`: freezes the replay at that fraction (clamped to [0, 1]); null when absent or invalid. */
export function parseReplayAt(search: string): number | null {
  const raw = new URLSearchParams(search).get('replayAt');
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}
