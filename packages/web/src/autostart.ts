import type { Rank } from '@lml/data/contracts';

export interface Autostart {
  rank: Rank;
  seed: number;
  /** `jungle=gromp-blue`: the blue jungler's start camp, kept only when it is one of `camps`. */
  junglerStart?: string;
}

/**
 * Parses `?autostart=1&rank=gold&seed=42` (optionally `&jungle=<camp id>`). Returns null unless autostart=1; bad
 * rank or seed fall back, an unknown camp is ignored (the seed picks the start).
 */
export function parseAutostart(
  search: string,
  ranks: Rank[],
  randomSeed: () => number = () => Math.floor(Math.random() * 1e9),
  camps: string[] = [],
): Autostart | null {
  const params = new URLSearchParams(search);
  if (params.get('autostart') !== '1') return null;
  const wanted = params.get('rank') as Rank | null;
  const rank = wanted && ranks.includes(wanted) ? wanted : ranks.includes('gold' as Rank) ? ('gold' as Rank) : ranks[0]!;
  const raw = params.get('seed');
  const parsed = raw !== null && raw.trim() !== '' ? Number(raw) : NaN;
  const seed = Number.isInteger(parsed) ? parsed : randomSeed();
  const jungle = params.get('jungle');
  return jungle !== null && camps.includes(jungle) ? { rank, seed, junglerStart: jungle } : { rank, seed };
}
