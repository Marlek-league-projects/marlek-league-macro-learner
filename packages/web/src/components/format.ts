// French display helpers shared by the components.
import type { GameData, Lane, ObjectiveId, Position, Role, Side } from '@lml/data/contracts';
import type { Choice, ContactKind, GameEvent, PlayerView, WavePos } from '@lml/engine/contracts';
import type { Screen } from '../store';

const ASSETS = './assets/';

export const roleIcon = (role: Role): string => `${ASSETS}roles/${role}.png`;

export const championImage = (data: GameData, id: string): string =>
  `${ASSETS}champions/${data.champions[id]?.image ?? `${id}.png`}`;

export const championName = (data: GameData, id: string): string => data.champions[id]?.name ?? id;

export const positionLabel = (data: GameData, id: string): string => data.graph.positions[id]?.label ?? id;

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

export const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

export const OBJECTIVE_LABEL: Record<ObjectiveId, string> = {
  scuttle: 'Carapateur',
  dragon: 'Dragon',
  voidgrubs: 'Larves',
  herald: 'Herald',
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

const CHOICE_LABEL = { farm: 'Farmer', fight: 'Combattre', flee: 'Fuir', trade: 'Trade' } as const;

/** Button label of a choice: the fight is an "All-in" on a lane contact. */
export function choiceLabel(kind: ContactKind, choice: Choice): string {
  return choice === 'fight' && kind === 'trade' ? 'All-in' : CHOICE_LABEL[choice];
}

const SIDE_LABEL: Record<Side, string> = { blue: 'Bleu', red: 'Rouge' };

const LANE_LABEL: Record<Lane, string> = { top: 'top', mid: 'mid', bot: 'bot' };

const WAVE_LABEL: Record<WavePos, string> = { [-1]: 'côté bleu', 0: 'au milieu', 1: 'côté rouge' };

/** One event of the log, in French. */
export function eventText(e: GameEvent, data: GameData): string {
  const name = (id: string) => championName(data, id);
  const names = (ids: string[]) => ids.map(name).join(', ') || 'personne';
  const at = (id: string) => positionLabel(data, id);
  switch (e.type) {
    case 'moved':
      return `${name(e.champion)} : ${at(e.from)} → ${at(e.to)}`;
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
      return `${SIDE_LABEL[e.side]} commence ${OBJECTIVE_LABEL[e.objective]} (${names(e.champions)})`;
    case 'objectiveTaken':
      return `${SIDE_LABEL[e.side]} prend ${OBJECTIVE_LABEL[e.objective]} à ${at(e.position)}`;
    case 'campCleared':
      return `Camp nettoyé : ${at(e.camp)} par ${name(e.champion)}`;
    case 'wardPlaced':
      return `Ward ${SIDE_LABEL[e.side].toLowerCase()} posée à ${at(e.position)}`;
    case 'wardCleared':
      return `Ward ${SIDE_LABEL[e.side].toLowerCase()} détruite à ${at(e.position)}`;
    case 'heraldLaunched':
      return `Herald lancé sur ${at(e.tower)}`;
  }
}

/** Engine validation errors (English) as a short French message. */
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/wards/.test(msg)) return 'Limite de wards atteinte pour ce round.';
  if (/unward/.test(msg)) return 'Un seul unward par round.';
  if (/herald/.test(msg)) return 'Le Herald se lance sur une tour adverse.';
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
