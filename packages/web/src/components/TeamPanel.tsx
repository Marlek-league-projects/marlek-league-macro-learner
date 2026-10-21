import type { ChampionState, EnemyInfo, PlayerView } from '@lml/engine/contracts';
import type { Store } from '../store';
import { type Hud, hpColor, hudValues } from './hud';
import { championImage, championName, num, objectiveScore, positionLabel, roleIcon } from './format';

interface Props {
  store: Store;
  team: 'ally' | 'enemy';
}

const pct = (share: number): string => `${Math.round(share * 100)}%`;
const tone = (n: number): string => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

/** HP bar, filled and coloured by the share of health left. */
function HpBar({ hp, max }: { hp: number; max: number }) {
  return (
    <div class="bar hp" title={`PV ${Math.round(hp * max)} / ${max}`}>
      <i style={{ width: pct(hp), background: hpColor(hp) }} />
    </div>
  );
}

export function TeamPanel({ store, team }: Props) {
  const view = store.view.value;
  if (!view) return null;
  return team === 'ally' ? <AllyTeam store={store} view={view} /> : <EnemyTeam store={store} view={view} />;
}

/** What the scoreboard does not show: Voidgrubs and plates. */
function Kpis({ view, side }: { view: PlayerView; side: 'blue' | 'red' }) {
  const taken = view.objectivesTaken[side];
  return (
    <>
      <span class="kpi">Larves <strong>{taken.voidgrubs ?? 0}</strong></span>
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
      <span class="muted">niv {level ?? '—'}</span>
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
  const hud = hudValues(view, data, store.level, store.estimateEnemy);
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
          const h = hud[c.id]!;
          const out = c.status !== 'alive';
          return (
            <div
              key={c.id}
              class={`card${store.selected.value === c.id ? ' sel' : ''}${canSelect && c.status !== 'dead' ? ' pick' : ''}`}
              onClick={() => canSelect && c.status !== 'dead' && store.select(store.selected.value === c.id ? null : c.id)}
            >
              <CardTitle store={store} id={c.id} role={c.role} level={h.level} />
              <div class="barrow"><span>PV</span><HpBar hp={h.hp} max={data.rules.health.max} /></div>
              <div class="barrow"><span>XP</span><div class="bar xp" title="XP vers le niveau suivant"><i style={{ width: pct(h.xp ?? 0) }} /></div></div>
              <div class="barrow">
                <span>Avance</span>
                <div class="bar lead" title={`Avance : or gagné ${num(c.goldEarned)}`}>
                  <i style={{ width: pct(c.goldEarned / bestGold) }} />
                </div>
              </div>
              {out ? (
                <span class="neg">
                  {recalled.includes(c.id) ? 'À la base' : 'Mort'} (retour round {c.respawnRound ?? view.round})
                </span>
              ) : (
                <span class="muted">Or en poche {num(c.gold)}{c.hasHerald ? ' · Herald' : ''}</span>
              )}
              <Power hud={h} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The card's power line; a dash when unknown. */
function Power({ hud }: { hud: Hud | undefined }) {
  return (
    <div class="muted" title="Puissance : niveau et avance (estimée pour un adversaire)">
      ⚔ Puissance <strong>{hud ? hud.power : '—'}</strong>
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
  const enemySide = view.side === 'blue' ? 'red' : 'blue';
  const hud = hudValues(view, store.data, store.level, store.estimateEnemy);
  return (
    <div class="team enemy">
      <div class="teamhead">
        <b style="color:var(--red)">Équipe adverse (rouge)</b>
        <Kpis view={view} side={enemySide} />
      </div>
      <div class="cards">
        {view.enemies.map((e) => {
          // Fog of war: HP, level and power only while the enemy is visible.
          const h = hud[e.id];
          return (
            <div key={e.id} class="card">
              <CardTitle store={store} id={e.id} role={e.role} level={h?.level ?? null} />
              {h ? <HpBar hp={h.hp} max={store.data.rules.health.max} /> : <div class="muted">PV —</div>}
              <Power hud={h} />
              <div class="muted">{seenText(store, e)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
