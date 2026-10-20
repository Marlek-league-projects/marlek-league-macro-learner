import type { ChampionState, EnemyInfo, PlayerView } from '@lml/engine/contracts';
import type { Store } from '../store';
import { estimateEnemy, leadShare, levelProgress, teamLead } from './estimate';
import { championImage, championName, num, positionLabel, roleIcon, signed } from './format';

interface Props {
  store: Store;
  team: 'ally' | 'enemy';
}

const pct = (share: number): string => `${Math.round(share * 100)}%`;
const tone = (n: number): string => (n >= 0 ? 'pos' : 'neg');

export function TeamPanel({ store, team }: Props) {
  const view = store.view.value;
  if (!view) return null;
  return team === 'ally' ? <AllyTeam store={store} view={view} /> : <EnemyTeam store={store} view={view} />;
}

function Kpis({ view, side }: { view: PlayerView; side: 'blue' | 'red' }) {
  const taken = view.objectivesTaken[side];
  return (
    <>
      <span class="kpi">Dragons <strong>{taken.dragon ?? 0}</strong></span>
      <span class="kpi">Larves <strong>{taken.voidgrubs ?? 0}</strong></span>
      <span class="kpi">Tours prises <strong>{view.towersDestroyed[side]}</strong></span>
    </>
  );
}

function CardTitle({ store, id, role, level }: { store: Store; id: string; role: ChampionState['role']; level: number | null }) {
  return (
    <div class="top">
      <span class="who">
        <img class="ri" src={roleIcon(role)} alt="" />
        <img class="sq" src={championImage(store.data, id)} alt="" />
        {championName(store.data, id)}
      </span>
      <span class="muted">niv {level ?? '?'}</span>
    </div>
  );
}

function AllyTeam({ store, view }: { store: Store; view: PlayerView }) {
  const { data } = store;
  const start = store.roundWindow().start;
  const lead = teamLead(view, data, start);
  const wardsUsed = Object.values(store.pending.value).filter((o) => o.kind !== 'spawn' && o.ward !== undefined).length;
  const canSelect = store.screen.value === 'orders';
  return (
    <div class="team ally">
      <div class="teamhead">
        <b style="color:var(--blue)">Ton équipe (bleu)</b>
        <span class="kpi">Avance équipe <strong class={tone(lead.gold)}>{signed(lead.gold)} or</strong></span>
        <span class="kpi">XP <strong class={tone(lead.xp)}>{signed(lead.xp)}</strong></span>
        <Kpis view={view} side={view.side} />
        <span class="kpi">Wards <strong>{wardsUsed} / {data.rules.wards.perRound}</strong></span>
      </div>
      <div class="cards">
        {view.allies.map((c) => {
          const level = store.level(c.xp);
          const out = c.status !== 'alive';
          return (
            <div
              key={c.id}
              class={`card${store.selected.value === c.id ? ' sel' : ''}${canSelect && c.status !== 'dead' ? ' pick' : ''}`}
              onClick={() => canSelect && c.status !== 'dead' && store.select(store.selected.value === c.id ? null : c.id)}
            >
              <CardTitle store={store} id={c.id} role={c.role} level={level} />
              <div class="bar xp"><i style={{ width: pct(levelProgress(data, c.xp, level)) }} /></div>
              <div class="bar lead"><i style={{ width: pct(leadShare(view, data, c, start)) }} /></div>
              {out ? (
                <span class="neg">Mort (retour round {c.respawnRound ?? view.round})</span>
              ) : (
                <span class="muted">Or non dépensé {num(c.gold)}{c.hasHerald ? ' · Herald' : ''}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function seenText(store: Store, e: EnemyInfo): string {
  if (e.visible && e.position) return `Vue : ${positionLabel(store.data, e.position)} (ce round)`;
  if (e.position && e.lastSeenRound !== null) {
    const when = e.lastSeenRound === 0 ? 'début de partie' : `round ${e.lastSeenRound}`;
    return `Dernière vue : ${positionLabel(store.data, e.position)} (${when})`;
  }
  return 'Jamais vu';
}

function EnemyTeam({ store, view }: { store: Store; view: PlayerView }) {
  const { data } = store;
  const start = store.roundWindow().start;
  const enemySide = view.side === 'blue' ? 'red' : 'blue';
  return (
    <div class="team enemy">
      <div class="cards">
        {view.enemies.map((e) => {
          const est = estimateEnemy(data, e, start);
          return (
            <div key={e.id} class="card">
              <CardTitle store={store} id={e.id} role={e.role} level={e.level} />
              <div class="bar xp">
                <i style={{ width: pct((e.level ?? 0) / data.rules.economy.levelXp.length) }} />
              </div>
              <div class="muted">{seenText(store, e)}</div>
              <div class="muted small">Or estimé {num(est.gold)}</div>
            </div>
          );
        })}
      </div>
      <div class="teamhead foot">
        <b style="color:var(--red)">Équipe adverse (rouge)</b>
        <Kpis view={view} side={enemySide} />
        <span class="kpi muted">Or et avance adverses : estimés d'après ce qui a été vu</span>
      </div>
    </div>
  );
}
