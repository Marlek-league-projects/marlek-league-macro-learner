export type BannerAction = 'confirm' | 'next' | 'new';

/** The banner's primary button for a screen (null: none). Enter triggers it, except on the game-over screen. */
export function bannerPrimary(screen: string): { action: BannerAction; label: string; enter: boolean } | null {
  if (screen === 'orders') return { action: 'confirm', label: 'Valider le round', enter: true };
  if (screen === 'review') return { action: 'next', label: 'Round suivant', enter: true };
  if (screen === 'over') return { action: 'new', label: 'Nouvelle partie', enter: false };
  return null;
}

/** "Revoir le tour" sits next to the primary button once a round has resolved. */
export function bannerHasReplay(screen: string): boolean {
  return screen === 'review' || screen === 'over';
}
