// Ward marker texts. The engine owns ward timing (`wardRoundsLeft`); the web only words it.
import type { Ward } from '@lml/engine/contracts';

/**
 * Tooltip of an own ward with `left` rounds left seen from `viewRound` (1 = its last active round). The Scuttle's
 * ward, shown on the dead Scuttle, is named instead (its eye shows the rounds left).
 */
export function wardTooltip(ward: Pick<Ward, 'scuttle'>, left: number, viewRound: number): string {
  return ward.scuttle ? 'Ward du Carapateur' : `Ward (expire au round ${viewRound + left - 1})`;
}
