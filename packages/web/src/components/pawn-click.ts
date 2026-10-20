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
