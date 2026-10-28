// What a click on a map pawn does, given the current selection.

export type PawnClick =
  | { kind: 'select'; id: string | null }
  | { kind: 'order'; to: string }
  | { kind: 'none' };

export interface ClickedPawn {
  id: string;
  position: string;
  ally: boolean;
}

/**
 * Clicking the selected pawn deselects it. With a pawn selected, clicking any other pawn on a position
 * it can reach orders the move there (pawns must not hide their node). Otherwise an ally pawn is selected.
 */
export function pawnClick(
  pawn: ClickedPawn,
  selectedId: string | null,
  reach: Record<string, number> | null,
): PawnClick {
  if (selectedId === pawn.id) return { kind: 'select', id: null };
  if (selectedId !== null && reach?.[pawn.position] !== undefined) return { kind: 'order', to: pawn.position };
  if (pawn.ally) return { kind: 'select', id: pawn.id };
  return { kind: 'none' };
}

/** While picking a flee step, a click on a pawn standing on an allowed step picks that step; any other does nothing. */
export function fleePawnClick(pawn: ClickedPawn, steps: Record<string, number> | null): PawnClick {
  return steps?.[pawn.position] !== undefined ? { kind: 'order', to: pawn.position } : { kind: 'none' };
}

/**
 * With a pawn selected, the icon and padding of a pawn standing on a position it cannot reach must not
 * swallow clicks meant for the node underneath; only its portrait stays clickable (to switch selection).
 */
export function pawnHitPassesThrough(
  pawn: ClickedPawn,
  selectedId: string | null,
  reach: Record<string, number> | null,
): boolean {
  return selectedId !== null && selectedId !== pawn.id && reach?.[pawn.position] === undefined;
}

/**
 * With a pawn selected, a click on a position it cannot reach does nothing: it must not reach the map
 * background, which would deselect the pawn.
 */
export function nodeClickKeepsSelection(position: string, reach: Record<string, number> | null): boolean {
  return reach !== null && reach[position] === undefined;
}
