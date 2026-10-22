// Regenerates the data of docs/movement-map.html from the game data and the engine's movement rules.
// Run after changing map.json, the movement rules or reachableFrom: `bun run movement-map`.
import { join } from 'node:path';
import { loadGameData } from '@lml/data';
import type { Side } from '@lml/data/contracts';
import { reachableFrom } from '../src/movement';

const PAGE = join(import.meta.dir, '..', '..', '..', 'docs', 'movement-map.html');
const SIDES: Side[] = ['blue', 'red'];

const d = loadGameData();
const ids = Object.keys(d.graph.positions);
const bonus = d.rules.moves.baseBonus;
// One step budget per round length in the rules (today only 20 s rounds).
const BUDGETS = [...new Set(Object.values(d.rules.moves.budgetBySeconds))].sort((a, b) => a - b);

const pos = Object.fromEntries(
  ids.map((id) => {
    const p = d.graph.positions[id]!;
    return [id, { x: p.x, y: p.y, label: p.label, kind: p.kind, side: p.side ?? null }];
  }),
);
const edges: [string, string][] = [];
for (const a of ids) for (const b of d.graph.adj[a] ?? []) if (a < b) edges.push([a, b]);
const reach = Object.fromEntries(
  SIDES.map((side) => [
    side,
    Object.fromEntries(
      BUDGETS.map((budget) => [
        budget,
        // A move from the side's own base gets the base bonus (see budgetFrom).
        Object.fromEntries(ids.map((id) => [id, reachableFrom(d, id, budget + (id === `base-${side}` ? bonus : 0), side)])),
      ]),
    ),
  ]),
);

const html = await Bun.file(PAGE).text();
const start = html.indexOf('const D=');
const end = html.indexOf(';let B=', start);
if (start < 0 || end < 0) throw new Error(`no "const D=...;let B=" data block in ${PAGE}`);
const label = Object.entries(d.rules.moves.budgetBySeconds).map(([s, b]) => `${b} pas (rounds de ${s} s)`).join(', ');
const next = html.slice(0, start) + 'const D=' + JSON.stringify({ pos, edges, reach, baseBonus: bonus, budgets: BUDGETS }) + html.slice(end);
const updated = next
  .replace(/\d+ liens, \d+ positions/, `${edges.length} liens, ${ids.length} positions`)
  .replace(/Budget : [^.]*\./, `Budget : ${label}.`);
await Bun.write(PAGE, updated);
console.log(`movement-map: ${ids.length} positions, ${edges.length} links${updated === html ? ' (unchanged)' : ' (updated)'}`);
