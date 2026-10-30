import type { Side } from '@lml/data/contracts';
import type { Store } from '../store';
import { RoundActions, shownRound } from './RoundBanner';
import { clock, placementWindow } from './format';
import { QuitGame } from './QuitGame';
import { type ScoreSide, scoreBarSides } from './score-bar';

const TEAM_NAME: Record<Side, string> = { blue: 'Bleu', red: 'Rouge' };

// Each half's look; red is mirrored, except on a phone where both read left to right.
const TEAM_CLASS: Record<Side, { team: string; name: string; stats: string }> = {
  blue: {
    team: 'border-l-4 border-blue-side bg-linear-to-r from-blue-side/13 to-transparent to-70%',
    name: 'text-blue-300',
    stats: 'ml-auto',
  },
  red: {
    team: 'flex-row-reverse border-r-4 border-red-side bg-linear-to-l from-red-side/13 to-transparent to-70% max-sm:flex-row max-sm:border-r-0 max-sm:border-l-4',
    name: 'text-right text-red-300',
    stats: 'mr-auto flex-row-reverse max-sm:mr-0 max-sm:ml-auto max-sm:flex-row',
  },
};

const statClass = 'flex min-w-[34px] flex-col items-center leading-[1.15]';
const statLabel = 'text-[10px] uppercase tracking-[.03em] text-mut';

/** One team's half: name, objectives and towers, gold (with the lead), kills next to the clock. Red is mirrored. */
function Team({ s, you }: { s: ScoreSide; you: boolean }) {
  const cls = TEAM_CLASS[s.side];
  return (
    <div class={`flex min-w-0 items-center gap-3.5 px-3.5 py-1.5 max-[1100px]:flex-wrap max-[1100px]:gap-2 max-[1100px]:px-2 ${cls.team}`}>
      <div class={`flex flex-col text-[15px] leading-[1.15] font-bold ${cls.name}`}>
        {TEAM_NAME[s.side]}
        <span class="text-[11px] font-medium text-mut">{you ? 'toi' : 'IA'}</span>
      </div>
      <div class={`flex min-w-0 flex-wrap gap-2.5 max-[1100px]:gap-1.5 ${cls.stats}`}>
        {s.stats.map((st) => (
          <span key={st.key} class={statClass} title={st.title}>
            <small class={statLabel}>{st.label}</small>
            <b class="text-[16px]">{st.value}</b>
          </span>
        ))}
      </div>
      <div class={statClass} title="Or gagné par l'équipe (et l'avance sur l'autre équipe)">
        <small class={statLabel}>Or</small>
        <b class="text-[17px] text-gold">{s.gold}</b>
        <span class="min-h-[13px] text-[11px] text-green-400">{s.lead ?? ''}</span>
      </div>
      <div class="min-w-10 text-center text-[30px] font-extrabold" title="Kills">{s.kills}</div>
    </div>
  );
}

/**
 * Broadcast-style score bar across the top, like a competitive match: blue on the left, red on the right, the game
 * clock, the round, the round's buttons and "Quitter la partie" in the middle. Everything shown is public.
 */
export function ScoreBar({ store, subtitle }: { store: Store; subtitle: string }) {
  const view = store.view.value;
  if (!view) return null;
  const sides = scoreBarSides(view.scoreboard);
  const round = shownRound(store);
  // Round 0 is the placement, before round 1 (0:00 → 0:55).
  const win = round === 0 ? placementWindow(store.data.rules) : store.roundWindow(round);
  const phase = round === 0 ? null : store.data.rules.phases[store.roundWindow(round).phase];
  return (
    <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] overflow-hidden rounded-[10px] border border-line bg-panel max-[1100px]:grid-cols-2 max-sm:grid-cols-1">
      <Team s={sides.blue} you={view.side === 'blue'} />
      <div class="flex items-center gap-3 border-x border-line bg-bg px-4 py-1 max-[1100px]:col-span-full max-[1100px]:row-start-1 max-[1100px]:justify-center max-[1100px]:border-x-0 max-[1100px]:border-b max-sm:flex-wrap">
        <div class="flex flex-col items-center leading-[1.15]">
          <div class="text-[24px] font-extrabold tabular-nums" title={`Ce round : ${clock(win.start)} → ${clock(win.end)}`}>{clock(win.start)}</div>
          <div class="whitespace-nowrap text-[13px] font-semibold">
            Round {round}/{store.totalRounds()}
            {round === 0 ? <> · <span class="text-gold">placement</span></> : phase && <> · <span class="text-gold">{phase.name}</span></>}
          </div>
          <div class="whitespace-nowrap text-[10px] text-mut">{subtitle}</div>
        </div>
        <RoundActions store={store} />
        <QuitGame store={store} />
      </div>
      <Team s={sides.red} you={view.side === 'red'} />
    </div>
  );
}
