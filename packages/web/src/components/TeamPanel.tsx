import type { ChampionState, EnemyInfo, PlayerView } from '@lml/engine/contracts';
import type { Store } from '../store';
import type { GameData } from '@lml/data/contracts';
import { championImage, championName, num, objectiveScore, positionLabel, roleIcon } from './format';

interface Props {
  store: Store;
  team: 'ally' | 'enemy';
}

const pct = (share: number): string => `${Math.round(share * 100)}%`;
const tone = (n: number): string => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

/** 0..1 progress through the current level. */
function levelProgress(data: GameData, xp: number, level: number): number {
  const table = data.rules.economy.levelXp;
  const from = table[level - 1] ?? 0;
  const to = table[level];
  if (to === undefined) return 1;
  return Math.min(1, Math.max(0, (xp - from) / (to - from)));
}

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
      <span class="kpi">Plaques <strong>{view.platesTaken[side]}</strong></span>
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
  const enemySide = view.side === 'blue' ? 'red' : 'blue';
  const gold = view.allies.reduce((sum, c) => sum + c.goldEarned, 0);
  const xp = view.allies.reduce((sum, c) => sum + c.xp, 0);
  const bestGold = Math.max(1, ...view.allies.map((c) => c.goldEarned));
  const ours = objectiveScore(view, data, view.side);
  const theirs = objectiveScore(view, data, enemySide);
  const wardsUsed = Object.values(store.pending.value).filter((o) => o.kind !== 'spawn' && o.ward !== undefined).length;
  const canSelect = store.screen.value === 'orders';
  const recalled = store.recalled.value;
  return (
    <div class="team ally">
      <div class="teamhead">
        <b style="color:var(--blue)">Ton équipe (bleu)</b>
        <span class="kpi">Or gagné <strong>{num(gold)}</strong></span>
        <span class="kpi">XP <strong>{num(xp)}</strong></span>
        <Kpis view={view} side={view.side} />
        <span class="kpi">Wards <strong>{wardsUsed} / {data.rules.wards.perRound}</strong></span>
        <span class="kpi" title="Objectifs, plaques et tours pris, toi contre l'adversaire">
          Objectifs <strong class={tone(ours - theirs)}>{num(ours)} – {num(theirs)}</strong>
        </span>
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
              <div class="bar lead" title={`Or gagné ${num(c.goldEarned)}`}>
                <i style={{ width: pct(c.goldEarned / bestGold) }} />
              </div>
              {out ? (
                <span class="neg">
                  {recalled.includes(c.id) ? 'À la base' : 'Mort'} (retour round {c.respawnRound ?? view.round})
                </span>
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
  const enemySide = view.side === 'blue' ? 'red' : 'blue';
  return (
    <div class="team enemy">
      <div class="cards">
        {view.enemies.map((e) => {
          return (
            <div key={e.id} class="card">
              <CardTitle store={store} id={e.id} role={e.role} level={e.level} />
              <div class="bar xp">
                <i style={{ width: pct((e.level ?? 0) / data.rules.economy.levelXp.length) }} />
              </div>
              <div class="muted">{seenText(store, e)}</div>
            </div>
          );
        })}
      </div>
      <div class="teamhead foot">
        <b style="color:var(--red)">Équipe adverse (rouge)</b>
        <Kpis view={view} side={enemySide} />
        <span class="kpi muted">Positions et niveaux : seulement ce qui a été vu</span>
      </div>
    </div>
  );
}
