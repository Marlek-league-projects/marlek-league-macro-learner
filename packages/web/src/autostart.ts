import type { Rank } from '@lml/data/contracts';

export interface Autostart {
  rank: Rank;
  seed: number;
}

/** Parses `?autostart=1&rank=gold&seed=42`. Returns null unless autostart=1; bad rank or seed fall back. */
export function parseAutostart(search: string, ranks: Rank[], randomSeed: () => number = () => Math.floor(Math.random() * 1e9)): Autostart | null {
  const params = new URLSearchParams(search);
  if (params.get('autostart') !== '1') return null;
  const wanted = params.get('rank') as Rank | null;
  const rank = wanted && ranks.includes(wanted) ? wanted : ranks.includes('gold' as Rank) ? ('gold' as Rank) : ranks[0]!;
  const raw = params.get('seed');
  const parsed = raw !== null && raw.trim() !== '' ? Number(raw) : NaN;
  const seed = Number.isInteger(parsed) ? parsed : randomSeed();
  return { rank, seed };
}
