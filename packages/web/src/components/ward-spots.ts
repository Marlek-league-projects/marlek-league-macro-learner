// Deep ward spots the engine allows in round 1 (validateOrders): the jungler on the enemy Blue Buff or Raptors.
import type { GameData, Role, Side } from '@lml/data/contracts';

export function deepWardSpots(data: GameData, champion: { role: Role; side: Side }, round: number): string[] {
  if (round !== 1 || champion.role !== 'jungle') return [];
  return Object.values(data.graph.positions)
    .filter((p) => p.kind === 'camp' && p.side !== champion.side && (p.camp === 'bluebuff' || p.camp === 'raptors'))
    .map((p) => p.id)
    .sort();
}
