// French display helpers shared by the components.
import type { GameData, Lane, ObjectiveId, Position, Role, Side } from '@lml/data/contracts';
import type { Choice, Contact, ContactKind, EnemyInfo, GameEvent, PlayerView, WavePos } from '@lml/engine/contracts';
import type { Screen } from '../store';

const ASSETS = './assets/';

export const roleIcon = (role: Role): string => `${ASSETS}roles/${role}.png`;

/** League's recall (B button) icon, drawn with an SVG `<image>`. */
export const recallIcon = (): string => `${ASSETS}recall.png`;

export const championImage = (data: GameData, id: string): string =>
  `${ASSETS}champions/${data.champions[id]?.image ?? `${id}.png`}`;

export const championName = (data: GameData, id: string): string => data.champions[id]?.name ?? id;

export const positionLabel = (data: GameData, id: string): string => data.graph.positions[id]?.label ?? id;

/** Where an enemy card says the enemy is: seen this round, met in a contact (until seen again), last seen, or never. */
export function enemySeenText(data: GameData, e: EnemyInfo): string {
  if (e.visible && e.position) return `Vue : ${positionLabel(data, e.position)} (ce round)`;
  if (e.met) return `Croisé : ${positionLabel(data, e.met.position)} (round ${e.met.round})`;
  if (e.position && e.lastSeenRound !== null) {
    const when = e.lastSeenRound === 0 ? 'début de partie' : `round ${e.lastSeenRound}`;
    return `Dernière vue : ${positionLabel(data, e.position)} (${when})`;
  }
  return 'Jamais vu';
}

/**
 * The round on screen for a view at `viewRound`: in review and once the game is over the view has
 * already moved on, so it is the round just played.
 */
export function shownRound(screen: Screen, viewRound: number): number {
  return screen === 'review' || screen === 'over' ? viewRound - 1 : viewRound;
}

/** `m:ss` from a time in seconds. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** French grouping (`1 450`), rounded. */
export const num = (n: number): string => Math.round(n).toLocaleString('fr-FR');

/** At most one decimal, French style (`0,5`). */
export const dec = (n: number): string => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** `+1 450` / `−320`. */
export const signed = (n: number): string => (Math.round(n) >= 0 ? `+${num(n)}` : `−${num(-n)}`);

/** Team gold advantage: `+1,2k` / `−3,4k` from 1 000 on, else `+800` / `−800` / `0`. */
export function goldLead(n: number): string {
  const r = Math.round(n);
  if (r === 0) return '0';
  const sign = r > 0 ? '+' : '−';
  const abs = Math.abs(r);
  if (abs < 1000) return `${sign}${abs}`;
  return `${sign}${(abs / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`;
}

export const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

export const OBJECTIVE_LABEL: Record<ObjectiveId, string> = {
  scuttle: 'Carapateur',
  dragon: 'Dragon',
  voidgrubs: 'Larves',
  herald: 'Héraut',
  baron: 'Nashor',
};

const KIND_LABEL: Record<Position['kind'], string> = {
  tower: 'tour',
  laneMid: 'voie',
  camp: 'camp',
  pit: 'objectif',
  scuttle: 'carapateur',
  base: 'base',
};

export const kindLabel = (p: Position): string => KIND_LABEL[p.kind];

export const CONTACT_LABEL: Record<ContactKind, string> = {
  trade: 'Échange en lane',
  pressure: 'Pression en lane',
  gank: 'Gank',
  objective: 'Objectif',
  invade: 'Invade',
  skirmish: 'Escarmouche',
};

const CHOICE_LABEL: Record<Choice, string> = {
  farm: 'Farmer sous la tour',
  fight: 'Combattre',
  flee: 'Fuir',
  trade: 'Trade',
  objective: "Continuer l'objectif",
};

/** Button label of a choice: on an even lane contact the fight is an "All-in" and farming is plain "Farmer". */
export function choiceLabel(kind: ContactKind, choice: Choice): string {
  if (kind === 'trade' && choice === 'fight') return 'All-in';
  if (kind === 'trade' && choice === 'farm') return 'Farmer';
  return CHOICE_LABEL[choice];
}

const ZONE_LABEL: Record<string, string> = {
  'lane-top': 'Lane top',
  'lane-mid': 'Lane mid',
  'lane-bot': 'Lane bot',
  'river-top': 'Rivière haut',
  'river-bot': 'Rivière bas',
};

const RIVER_PIT: Record<string, 'baron-pit' | 'dragon-pit'> = { 'river-top': 'baron-pit', 'river-bot': 'dragon-pit' };

/**
 * A contact's title from its zone: "Lane top", "Rivière haut (Carapateur + Nashor)" (the pit's objective up, or
 * the next one it hosts at `now`), or the position's name for a camp zone.
 */
export function zoneTitle(contact: Pick<Contact, 'id' | 'position'>, view: Pick<PlayerView, 'pits'>, data: GameData, now: number): string {
  const zone = ZONE_LABEL[contact.id];
  if (!zone) return positionLabel(data, data.graph.positions[contact.id] ? contact.id : contact.position);
  const pit = RIVER_PIT[contact.id];
  if (!pit) return zone;
  const objective = view.pits[pit].objective ?? pitObjectiveAt(data, pit, now);
  return `${zone} (${OBJECTIVE_LABEL.scuttle} + ${OBJECTIVE_LABEL[objective]})`;
}

const OBJECTIVE_ARTICLE: Record<ObjectiveId, string> = {
  scuttle: 'le',
  dragon: 'le',
  voidgrubs: 'les',
  herald: 'le',
  baron: 'le',
};

/** "le Dragon", "les Larves". */
export const objectiveWithArticle = (objective: ObjectiveId): string => `${OBJECTIVE_ARTICLE[objective]} ${OBJECTIVE_LABEL[objective]}`;

/** The objective prompt's main button: "Faire le Dragon", plus " + Carapateur" when the river's Scuttle is up too. */
export function objectiveActionLabel(objective: ObjectiveId, withScuttle: boolean): string {
  const main = `Faire ${objectiveWithArticle(objective)}`;
  return withScuttle ? `${main} + ${OBJECTIVE_LABEL.scuttle}` : main;
}

export const SIDE_LABEL: Record<Side, string> = { blue: 'Bleu', red: 'Rouge' };

const LANE_LABEL: Record<Lane, string> = { top: 'top', mid: 'mid', bot: 'bot' };

const WAVE_LABEL: Record<WavePos, string> = { [-1]: 'côté bleu', 0: 'au milieu', 1: 'côté rouge' };

/** One event of the log, in French. */
export function eventText(e: GameEvent, data: GameData): string {
  const name = (id: string) => championName(data, id);
  const names = (ids: string[]) => ids.map(name).join(', ') || 'personne';
  const at = (id: string) => positionLabel(data, id);
  switch (e.type) {
    case 'moved':
      return e.acted === false
        ? `${name(e.champion)} arrive à ${at(e.to)} (sans action)`
        : `${name(e.champion)} : ${at(e.from)} → ${at(e.to)}`;
    case 'fled':
      return `${name(e.champion)} fuit vers ${at(e.to)}`;
    case 'fight': {
      const result = e.winner ? `victoire ${SIDE_LABEL[e.winner].toLowerCase()}` : 'égalité';
      return `Combat à ${at(e.position)} (${names(e.blue)} contre ${names(e.red)}) : ${result}`;
    }
    case 'trade':
      return `Échange en lane ${LANE_LABEL[e.lane]} : ${e.winner ? `avantage ${SIDE_LABEL[e.winner].toLowerCase()}` : 'égalité'}`;
    case 'death':
      return `${name(e.champion)} meurt à ${at(e.position)} (retour round ${e.respawnRound})`;
    case 'recall':
      return `${name(e.champion)} rentre à la base et dépense ${num(e.itemsBought)} or`;
    case 'wave':
      return `Vague ${LANE_LABEL[e.lane]} : ${WAVE_LABEL[e.from]} → ${WAVE_LABEL[e.to]}`;
    case 'towerDamage':
      return e.destroyed
        ? `${at(e.tower)} détruite`
        : `${at(e.tower)} : −${dec(e.damage)} PV (reste ${dec(e.hp)})`;
    case 'objectiveStarted':
      return `${SIDE_LABEL[e.side]} commence ${objectiveWithArticle(e.objective)} (${names(e.champions)})`;
    case 'objectiveTaken':
      return `${SIDE_LABEL[e.side]} prend ${objectiveWithArticle(e.objective)} à ${at(e.position)}`;
    case 'campCleared':
      return `Camp nettoyé : ${at(e.camp)} par ${name(e.champion)}`;
    case 'wardPlaced':
      return `Ward ${SIDE_LABEL[e.side].toLowerCase()} posée à ${at(e.position)}`;
    case 'wardCleared':
      return `Ward ${SIDE_LABEL[e.side].toLowerCase()} détruite à ${at(e.position)}`;
    case 'wardSpotted':
      return `Ward à ${at(e.position)} : ${name(e.champion)} repéré${e.to ? ` → ${at(e.to)}` : ''}`;
    case 'heraldLaunched':
      return `Héraut lancé sur ${at(e.tower)}`;
    case 'hpLost':
      return `${name(e.champion)} −${num(e.amount)} PV`;
  }
}

/** The log's lines: one per event, except a move onto a camp and that champion clearing it, told as one line. */
export function eventLines(events: GameEvent[], data: GameData): string[] {
  const merged = new Set<GameEvent>();
  const out: string[] = [];
  for (const e of events) {
    if (merged.has(e)) continue;
    if (e.type === 'moved' && e.acted !== false) {
      const cleared = events.find((x) => x.type === 'campCleared' && x.champion === e.champion && x.camp === e.to);
      if (cleared) {
        merged.add(cleared);
        out.push(`${championName(data, e.champion)} se déplace vers ${positionLabel(data, e.to)} et tue le camp`);
        continue;
      }
    }
    out.push(eventText(e, data));
  }
  return out;
}

/** Engine validation errors (English) as a short French message. */
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/wards/.test(msg)) return 'Limite de wards atteinte pour ce round.';
  if (/unward/.test(msg)) return 'Un seul unward par round.';
  if (/herald/.test(msg)) return 'Le Héraut se lance sur une tour adverse.';
  if (/reach/.test(msg)) return 'Position hors de portée ce round.';
  if (/spawn/.test(msg)) return 'Point de réapparition invalide.';
  return `Ordre refusé : ${msg}`;
}

const PIT_SEQUENCE: Record<'baron-pit' | 'dragon-pit', ObjectiveId[]> = {
  'dragon-pit': ['dragon'],
  'baron-pit': ['voidgrubs', 'herald', 'baron'],
};

/** Objective a pit hosts at time `t` (the first of its sequence not yet despawned). */
export function pitObjectiveAt(data: GameData, pit: 'baron-pit' | 'dragon-pit', t: number): ObjectiveId {
  const seq = PIT_SEQUENCE[pit];
  return seq.find((id) => {
    const despawn = data.rules.objectives[id].despawnAt;
    return despawn === null || despawn > t;
  }) ?? seq[seq.length - 1]!;
}

export interface Upcoming {
  objective: ObjectiveId;
  at: number;
}

/** Pit objectives alive now, and the next pit spawn, from what the view shows. */
export function objectiveTimers(view: PlayerView, data: GameData): { alive: ObjectiveId[]; next: Upcoming | null } {
  const alive: ObjectiveId[] = [];
  let next: Upcoming | null = null;
  for (const id of ['dragon-pit', 'baron-pit'] as const) {
    const pit = view.pits[id];
    if (pit.objective) alive.push(pit.objective);
    else if (pit.nextSpawn !== null && (!next || pit.nextSpawn < next.at)) {
      next = { objective: pitObjectiveAt(data, id, pit.nextSpawn), at: pit.nextSpawn };
    }
  }
  return { alive, next };
}

/** A side's objective score from public info only: objectives, plates and towers taken (no gold). */
export function objectiveScore(view: PlayerView, data: GameData, side: Side): number {
  const { objectives, verdict } = data.rules;
  let score = 0;
  for (const [id, n] of Object.entries(view.objectivesTaken[side])) {
    score += (n ?? 0) * objectives[id as ObjectiveId].value;
  }
  return score + view.platesTaken[side] * verdict.plateValue + view.towersDestroyed[side] * verdict.towerValue;
}
