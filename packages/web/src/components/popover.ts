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
 * Tries right of the pawn, left, below, then above, each clamped so it stays inside `area` (the box's size, or
 * the part of the box that is on screen; pinned top-left when it is larger), and keeps the one that covers the
 * fewest `avoid` points (the positions the pawn can be ordered to, so they stay clickable) or the pawn itself.
 * On a tie, the one the clamp moved least from its intended spot (it then sits clear of the pawn), then the first.
 */
export function placePopover(
  anchor: Point,
  pop: Size,
  area: Size | Region,
  avoid: Point[] = [],
  gap = POPOVER_GAP,
): { left: number; top: number } {
  const region: Region = 'width' in area ? { left: 0, top: 0, right: area.width, bottom: area.height } : area;
  const midX = anchor.x - pop.width / 2;
  const midY = anchor.y - pop.height / 2;
  const intended = [
    { left: anchor.x + gap, top: midY },
    { left: anchor.x - gap - pop.width, top: midY },
    { left: midX, top: anchor.y + gap },
    { left: midX, top: anchor.y - gap - pop.height },
  ];
  const points = [anchor, ...avoid];
  const covered = (c: { left: number; top: number }) =>
    points.filter((p) =>
      p.x > c.left - AVOID_MARGIN && p.x < c.left + pop.width + AVOID_MARGIN
      && p.y > c.top - AVOID_MARGIN && p.y < c.top + pop.height + AVOID_MARGIN).length;
  const scored = intended.map((want) => {
    const at = clampInside(want, pop, region);
    return { at, covered: covered(at), moved: Math.hypot(at.left - want.left, at.top - want.top) };
  });
  let best = scored[0]!;
  for (const c of scored.slice(1)) {
    if (c.covered < best.covered || (c.covered === best.covered && c.moved < best.moved)) best = c;
  }
  return best.at;
}

/**
 * Which edge of the map the contact prompts dock to: the half (by height, `ys` relative 0..1) holding fewer of the
 * round's contacts, so the prompts leave the contact rings visible; the bottom on a tie.
 */
export function contactDock(ys: number[]): 'top' | 'bottom' {
  const upper = ys.filter((y) => y < 0.5).length;
  return ys.length - upper > upper ? 'top' : 'bottom';
}

/** A rectangle by its edges (px). */
export interface Region {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The part of a `box`-sized map box (its top-left at `origin` in viewport px) that lies inside a `viewport`-sized
 * window, in box px. Falls back to the whole box when they do not overlap.
 */
export function visibleRegion(origin: Point, box: Size, viewport: Size): Region {
  const r = {
    left: Math.max(0, -origin.x),
    top: Math.max(0, -origin.y),
    right: Math.min(box.width, viewport.width - origin.x),
    bottom: Math.min(box.height, viewport.height - origin.y),
  };
  return r.right > r.left && r.bottom > r.top ? r : { left: 0, top: 0, right: box.width, bottom: box.height };
}

/** Moves a `pop`-sized panel at `at` inside `region` (pinned to its top-left corner when the panel is larger). */
export function clampInside(at: { left: number; top: number }, pop: Size, region: Region): { left: number; top: number } {
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));
  return {
    left: clamp(at.left, region.left, region.right - pop.width),
    top: clamp(at.top, region.top, region.bottom - pop.height),
  };
}
