// Where the selected pawn's actions popover goes inside the map box.

export interface Size {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/** Gap between the pawn and the popover (px). */
export const POPOVER_GAP = 22;

/** Margin around each point the popover should not cover (px), about a position's click circle. */
export const AVOID_MARGIN = 16;

/**
 * Top-left corner of a `pop`-sized popover next to the pawn at `anchor` (px, relative to the box).
 * Tries right of the pawn, left, below, then above, each clamped so it stays inside the box (pinned
 * top-left when it is larger than the box), and keeps the first that covers the fewest `avoid` points
 * (the positions the pawn can be ordered to, so they stay clickable) or the pawn itself.
 */
export function placePopover(
  anchor: Point,
  pop: Size,
  box: Size,
  avoid: Point[] = [],
  gap = POPOVER_GAP,
): { left: number; top: number } {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
  const at = (x: number, y: number) => ({ left: clamp(x, box.width - pop.width), top: clamp(y, box.height - pop.height) });
  const midX = anchor.x - pop.width / 2;
  const midY = anchor.y - pop.height / 2;
  const candidates = [
    at(anchor.x + gap, midY),
    at(anchor.x - gap - pop.width, midY),
    at(midX, anchor.y + gap),
    at(midX, anchor.y - gap - pop.height),
  ];
  const points = [anchor, ...avoid];
  const covered = (c: { left: number; top: number }) =>
    points.filter((p) =>
      p.x > c.left - AVOID_MARGIN && p.x < c.left + pop.width + AVOID_MARGIN
      && p.y > c.top - AVOID_MARGIN && p.y < c.top + pop.height + AVOID_MARGIN).length;
  let best = candidates[0]!;
  let bestCovered = covered(best);
  for (const c of candidates.slice(1)) {
    const n = covered(c);
    if (n < bestCovered) {
      best = c;
      bestCovered = n;
    }
  }
  return best;
}

/**
 * Which edge of the map the contact prompts dock to: the half (by height, `ys` relative 0..1) holding fewer of the
 * round's contacts, so the prompts leave the contact rings visible; the bottom on a tie.
 */
export function contactDock(ys: number[]): 'top' | 'bottom' {
  const upper = ys.filter((y) => y < 0.5).length;
  return ys.length - upper > upper ? 'top' : 'bottom';
}
