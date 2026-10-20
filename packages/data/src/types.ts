export type Side = 'blue' | 'red';
export type Role = 'top' | 'jungle' | 'mid' | 'adc' | 'support';
export type Lane = 'top' | 'mid' | 'bot';
export type Stage = 0 | 1 | 2 | 3 | 4;
export type PerStage = [number, number, number, number, number];
export type CampType = 'bluebuff' | 'gromp' | 'wolves' | 'raptors' | 'redbuff' | 'krugs';

export interface Position {
  id: string;
  label: string;
  kind: 'tower' | 'laneMid' | 'camp' | 'pit' | 'scuttle' | 'base';
  x: number;
  y: number;
  side?: Side;
  lane?: Lane;
  tier?: 1 | 2 | 3;
  camp?: CampType;
  pit?: 'baron' | 'dragon';
}

export interface MapData {
  positions: Pick<Position, 'id' | 'label' | 'x' | 'y'>[];
  edges: [string, string][];
}

export interface MapGraph {
  positions: Record<string, Position>;
  adj: Record<string, string[]>;
  distance(a: string, b: string): number;
  lanePositions(lane: Lane): string[];
  /** Ordered T1, T2, T3. */
  towers(side: Side, lane: Lane): string[];
}
