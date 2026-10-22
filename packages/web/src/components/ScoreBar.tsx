import type { Side } from '@lml/data/contracts';
import type { Store } from '../store';
import { RoundActions, shownRound } from './RoundBanner';
import { clock } from './format';
import { type ScoreSide, scoreBarSides } from './score-bar';

const TEAM_NAME: Record<Side, string> = { blue: 'Bleu', red: 'Rouge' };

/** One team's half: name, objectives and towers, gold (with the lead), kills next to the clock. Red is mirrored. */
function Team({ s, you }: { s: ScoreSide; you: boolean }) {
  return (
    <div class={`sbar-team ${s.side}`}>
      <div class="sbar-name">
        {TEAM_NAME[s.side]}
        <span class="muted">{you ? 'toi' : 'IA'}</span>
      </div>
      <div class="sbar-stats">
        {s.stats.map((st) => (
          <span key={st.key} class="sbar-stat" title={st.title}>
            <small>{st.label}</small>
            <b>{st.value}</b>
          </span>
        ))}
      </div>
      <div class="sbar-gold" title="Or gagné par l'équipe (et l'avance sur l'autre équipe)">
        <small>Or</small>
        <b>{s.gold}</b>
        <span class="sbar-lead">{s.lead ?? ''}</span>
      </div>
      <div class="sbar-kills" title="Kills">{s.kills}</div>
    </div>
  );
}

/**
 * Broadcast-style score bar across the top, like a competitive match: blue on the left, red on the right, the game
 * clock, the round and the round's buttons in the middle. Everything shown is public.
 */
export function ScoreBar({ store, subtitle }: { store: Store; subtitle: string }) {
  const view = store.view.value;
  if (!view) return null;
  const sides = scoreBarSides(view.scoreboard);
  const round = shownRound(store);
  const win = store.roundWindow(round);
  const phase = store.data.rules.phases[win.phase];
  return (
    <div class="sbar">
      <Team s={sides.blue} you={view.side === 'blue'} />
      <div class="sbar-mid">
        <div class="sbar-clock-box">
          <div class="sbar-clock" title={`Ce round : ${clock(win.start)} → ${clock(win.end)}`}>{clock(win.start)}</div>
          <div class="sbar-round">
            Round {round}/{store.totalRounds()}
            {phase && <> · <span class="phase">{phase.name}</span></>}
          </div>
          <div class="sbar-sub muted">{subtitle}</div>
        </div>
        <RoundActions store={store} />
      </div>
      <Team s={sides.red} you={view.side === 'red'} />
    </div>
  );
}
