import type { ChampionState, PlayerView } from '@lml/engine/contracts';
import type { Store } from '../store';
import { type Hud, hpColor, hudValues, metHud } from './hud';
import { championImage, championName, enemySeenText, num, objectiveScore, roleIcon } from './format';
import { champSq, roleIco } from './ui';

interface Props {
  store: Store;
  team: 'ally' | 'enemy';
}

const pct = (share: number): string => `${Math.round(share * 100)}%`;
const tone = (n: number): string => (n > 0 ? 'text-green-400' : n < 0 ? 'text-red-400' : 'text-txt');

const teamBox = 'rounded-[10px] border border-line bg-panel px-3 py-2.5';
const teamHead = 'mb-2 flex flex-wrap items-center gap-4 text-[13px]';
const card = 'rounded-lg border bg-bg px-2 py-1.5 text-[12px]';
const barRow = 'flex items-center gap-[5px] [&>span]:w-[34px] [&>span]:flex-none [&>span]:text-[10px] [&>span]:text-mut';
/** A thin gauge; its fill is the `<i>` inside. */
const bar = (height = 'h-1.5'): string => `mt-1 mb-0.5 flex-1 overflow-hidden rounded-[3px] bg-raised ${height}`;
const fill = 'block h-full';

/** Five cards in a row on the game over screen, one per line in the game's side columns. */
const cardsClass = (store: Store): string => `grid gap-1.5 ${store.screen.value === 'over' ? 'grid-cols-5' : 'grid-cols-1'}`;

/** HP bar, filled and coloured by the share of health left. */
function HpBar({ hp, max }: { hp: number; max: number }) {
  return (
    <div class={bar('h-[5px]')} title={`PV ${Math.round(hp * max)} / ${max}`}>
      <i class={fill} style={{ width: pct(hp), background: hpColor(hp) }} />
    </div>
  );
}

export function TeamPanel({ store, team }: Props) {
  const view = store.view.value;
  if (!view) return null;
  return team === 'ally' ? <AllyTeam store={store} view={view} /> : <EnemyTeam store={store} view={view} />;
}

function CardTitle({ store, id, role, level }: { store: Store; id: string; role: ChampionState['role']; level: number | null }) {
  return (
    <div class="flex justify-between gap-1 font-semibold">
      <span class="flex min-w-0 items-center overflow-hidden text-ellipsis whitespace-nowrap">
        <img class={roleIco} src={roleIcon(role)} alt="" />
        <img class={champSq} src={championImage(store.data, id)} alt="" />
        {championName(store.data, id)}
      </span>
      <span class="text-mut">niv {level ?? '—'}</span>
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
  const canSelect = store.screen.value === 'orders' || store.screen.value === 'placement';
  const recalled = store.recalled.value;
  const hud = hudValues(view, data, store.level, store.estimateEnemy);
  const idle = store.screen.value === 'orders' ? store.championsWithoutOrder() : [];
  return (
    <div class={`${teamBox} border-t-3 border-t-blue-side`}>
      <div class={teamHead}>
        <b class="text-[14px] text-blue-side">Ton équipe (bleu)</b>
        <span class="text-mut">Or gagné <strong class="text-txt">{num(gold)}</strong></span>
        <span class="text-mut">XP <strong class="text-txt">{num(xp)}</strong></span>
        <span class="text-mut">Wards <strong class="text-txt">{wardsUsed} / {data.rules.wards.perRound}</strong></span>
        <span class="text-mut" title="Objectifs, plaques et tours pris, toi contre l'adversaire">
          Objectifs <strong class={tone(ours - theirs)}>{num(ours)} – {num(theirs)}</strong>
        </span>
      </div>
      <div class={cardsClass(store)}>
        {view.allies.map((c) => {
          const h = hud[c.id]!;
          const out = c.status !== 'alive';
          return (
            <div
              key={c.id}
              class={`${card} ${store.selected.value === c.id ? 'border-yellow-300' : 'border-line'}${canSelect && c.status !== 'dead' ? ' cursor-pointer hover:border-line-strong' : ''}`}
              onClick={() => canSelect && c.status !== 'dead' && store.select(store.selected.value === c.id ? null : c.id)}
            >
              <CardTitle store={store} id={c.id} role={c.role} level={h.level} />
              <div class={barRow}><span>PV</span><HpBar hp={h.hp} max={data.rules.health.max} /></div>
              <div class={barRow}><span>XP</span><div class={bar()} title="XP vers le niveau suivant"><i class={`${fill} bg-violet-400`} style={{ width: pct(h.xp ?? 0) }} /></div></div>
              <div class={barRow}>
                <span>Avance</span>
                <div class={bar()} title={`Avance : or gagné ${num(c.goldEarned)}`}>
                  <i class={`${fill} bg-cyan-400`} style={{ width: pct(c.goldEarned / bestGold) }} />
                </div>
              </div>
              {out ? (
                <span class="text-red-400">
                  {recalled.includes(c.id) ? 'À la base' : 'Mort'} (retour round {c.respawnRound ?? view.round})
                </span>
              ) : (
                <span class="text-mut">Or en poche {num(c.gold)}{c.hasHerald ? ' · Héraut' : ''}</span>
              )}
              <Power hud={h} />
              {idle.includes(c.id) && <div class="font-semibold text-amber-500" title="Aucun ordre : ce pion ne fera rien ce round">? Sans ordre</div>}
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
    <div class="text-mut" title="Puissance : niveau et avance (estimée pour un adversaire)">
      ⚔ Puissance <strong>{hud ? hud.power : '—'}</strong>
    </div>
  );
}

function EnemyTeam({ store, view }: { store: Store; view: PlayerView }) {
  const hud = hudValues(view, store.data, store.level, store.estimateEnemy);
  return (
    <div class={`${teamBox} border-b-3 border-b-red-side`}>
      <div class={teamHead}>
        <b class="text-[14px] text-red-side">Équipe adverse (rouge)</b>
      </div>
      <div class={cardsClass(store)}>
        {view.enemies.map((e) => {
          // Fog of war: HP, level and power only while the enemy is visible, or as they were when last met.
          const h = hud[e.id] ?? metHud(e, store.data, store.estimateEnemy) ?? undefined;
          return (
            <div key={e.id} class={`${card} border-line`}>
              <CardTitle store={store} id={e.id} role={e.role} level={h?.level ?? null} />
              {h ? <HpBar hp={h.hp} max={store.data.rules.health.max} /> : <div class="text-mut">PV —</div>}
              <Power hud={h} />
              <div class="text-mut">{enemySeenText(store.data, e)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
