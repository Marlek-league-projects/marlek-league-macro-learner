// The broadcast score bar's numbers, per team: all public information (gold earned is the README's declared exception).
import type { Side } from '@lml/data/contracts';
import type { Scoreboard } from '@lml/engine/contracts';
import { goldLead } from './format';

export interface ScoreStat {
  key: 'towers' | 'plates' | 'voidgrubs' | 'heralds' | 'dragons' | 'barons';
  label: string;
  value: number;
  title: string;
}

export interface ScoreSide {
  side: Side;
  kills: number;
  /** Total gold earned, short: "12,3k". */
  gold: string;
  /** The gold difference on the side ahead ("+1,2k"); null on the other side and on a tie. */
  lead: string | null;
  /** Towers, plates, voidgrubs, heralds, dragons, barons, in that order (from the outside in on the bar). */
  stats: ScoreStat[];
}

/** Gold, short like a broadcast: "850", "12,3k". */
export function goldShort(n: number): string {
  const r = Math.round(n);
  if (Math.abs(r) < 1000) return String(r);
  return `${(r / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`;
}

/** Both teams' sides of the bar, from the view's scoreboard. */
export function scoreBarSides(s: Scoreboard): Record<Side, ScoreSide> {
  const diff = Math.round(s.goldEarned.blue - s.goldEarned.red);
  const of = (side: Side): ScoreSide => {
    const ahead = side === 'blue' ? diff > 0 : diff < 0;
    return {
      side,
      kills: s.kills[side],
      gold: goldShort(s.goldEarned[side]),
      lead: ahead ? goldLead(Math.abs(diff)) : null,
      stats: [
        { key: 'towers', label: 'Tours', value: s.towersDestroyed[side], title: 'Tours détruites' },
        { key: 'plates', label: 'Plaques', value: s.plates[side], title: 'Plaques de tour prises' },
        { key: 'voidgrubs', label: 'Larves', value: s.voidgrubs[side], title: 'Larves du Néant prises' },
        { key: 'heralds', label: 'Hérauts', value: s.heralds[side], title: 'Hérauts pris' },
        { key: 'dragons', label: 'Dragons', value: s.dragons[side], title: 'Dragons pris' },
        { key: 'barons', label: 'Nashor', value: s.barons[side], title: 'Nashor pris' },
      ],
    };
  };
  return { blue: of('blue'), red: of('red') };
}
