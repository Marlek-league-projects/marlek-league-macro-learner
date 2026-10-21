/**
 * A ward placed in round N is active for round N+1 and then fades. Seen from `viewRound` (the round being
 * ordered, or the one about to be resolved after a review), it has `placedRound + 2 - viewRound` rounds left
 * (1 = last active round); never below 1.
 */
export function wardRoundsLeft(placedRound: number, viewRound: number): number {
  return Math.max(1, placedRound + 2 - viewRound);
}

/** The last round the ward is active. */
export function wardExpiryRound(placedRound: number): number {
  return placedRound + 1;
}

export function wardTooltip(placedRound: number): string {
  return `Ward (expire au round ${wardExpiryRound(placedRound)})`;
}
