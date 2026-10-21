// TEMPORARY (Task 5 worktree only): stand-ins for the Task 1 (stepBudget, canAct, route) and Task 3
// (wardRoundsLeft) engine functions, so the web builds and runs before those tasks merge.
// At the merge, drop this file and wire the real functions into createEngine.
import type { GameData, Rules, Side } from '@lml/data/contracts';
import type { Ward } from './contracts';
import { roundWindow } from './time';

const BUDGET_BY_SECONDS: Record<string, number> = { '20': 2, '40': 3, '60': 4 };

export function stepBudget(rules: Rules, round: number): number {
  const table = (rules.moves as { budgetBySeconds?: Record<string, number> }).budgetBySeconds ?? BUDGET_BY_SECONDS;
  return table[String(roundWindow(rules, round).seconds)] ?? 2;
}

export const canAct = (distance: number, budget: number): boolean => distance < budget;

export function route(data: GameData, from: string, to: string, _side: Side): string[] {
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length && !prev.has(to); i++) {
    for (const n of [...(data.graph.adj[queue[i]!] ?? [])].sort()) {
      if (!prev.has(n)) {
        prev.set(n, queue[i]!);
        queue.push(n);
      }
    }
  }
  if (!prev.has(to)) return [from];
  const path: string[] = [];
  for (let at: string | null = to; at !== null; at = prev.get(at) ?? null) path.unshift(at);
  return path;
}

export function wardRoundsLeft(ward: Ward, round: number, rules: Rules): number {
  const duration = (rules.wards as { duration?: number }).duration ?? 1;
  return Math.max(1, ward.placedRound + duration + 1 - round);
}
