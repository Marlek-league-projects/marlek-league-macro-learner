import type { Rules, Stage } from '@lml/data/contracts';

export interface RoundWindow {
  start: number;
  end: number;
  phase: number;
  stage: Stage;
  seconds: number;
}

/** Number of rounds in a phase (its duration divided by its round length). */
function phaseRounds(p: Rules['phases'][number]): number {
  return Math.round((p.end - p.start) / p.roundSeconds);
}

export function totalRounds(rules: Rules): number {
  return rules.phases.reduce((n, p) => n + phaseRounds(p), 0);
}

/** Time window covered by a 1-based round. */
export function roundWindow(rules: Rules, round: number): RoundWindow {
  let first = 1;
  for (let phase = 0; phase < rules.phases.length; phase++) {
    const p = rules.phases[phase]!;
    const count = phaseRounds(p);
    if (round < first + count) {
      const start = p.start + (round - first) * p.roundSeconds;
      return { start, end: start + p.roundSeconds, phase, stage: p.stage, seconds: p.roundSeconds };
    }
    first += count;
  }
  throw new RangeError(`round ${round} out of range 1..${totalRounds(rules)}`);
}
