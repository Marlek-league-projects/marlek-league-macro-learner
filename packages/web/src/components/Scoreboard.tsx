import type { Side } from '@lml/data/contracts';
import type { Store } from '../store';
import { goldLead } from './format';

/** League-style scoreboard, you – the enemy: kills, towers, Dragons, Nashor and the team gold advantage. */
export function Scoreboard({ store }: { store: Store }) {
  const view = store.view.value;
  if (!view) return null;
  const s = view.scoreboard;
  const me = view.side;
  const them: Side = me === 'blue' ? 'red' : 'blue';
  const lead = Math.round(s.goldEarned[me] - s.goldEarned[them]);
  const pair = (label: string, r: Record<Side, number>) => (
    <span class="sb-item">
      {label} <b class="sb-me">{r[me]}</b> – <b class="sb-them">{r[them]}</b>
    </span>
  );
  return (
    <div class="scoreboard">
      {pair('Kills', s.kills)}
      {pair('Tours', s.towersDestroyed)}
      {pair('Dragons', s.dragons)}
      {pair('Nashor', s.barons)}
      <span class="sb-item" title="Or gagné par ton équipe moins celui de l'équipe adverse">
        Or <b class={lead > 0 ? 'pos' : lead < 0 ? 'neg' : ''}>{goldLead(lead)}</b>
      </span>
    </div>
  );
}
