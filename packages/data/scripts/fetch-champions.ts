// Offline script: fetches champion data from Data Dragon and assets from CommunityDragon.
// Run with `bun run fetch-data`. Outputs are committed; the game never calls these sources at runtime.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChampionBase } from '../src/types';

const DDRAGON = 'https://ddragon.leagueoflegends.com';
const CDRAGON = 'https://raw.communitydragon.org/latest';
const DATA_DIR = join(import.meta.dir, '..', 'data');
const ASSETS_DIR = join(import.meta.dir, '..', '..', 'web', 'public', 'assets');

const ROLE_ICONS: Record<string, string> = {
  top: 'top',
  jungle: 'jungle',
  mid: 'middle',
  adc: 'bottom',
  support: 'utility',
};

interface DDragonChampion {
  id: string;
  name: string;
  tags: string[];
  image: { full: string };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  await Bun.write(dest, await res.arrayBuffer());
}

/** Runs `task` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: limit }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await task(item);
  });
  await Promise.all(workers);
}

const versions = await getJson<string[]>(`${DDRAGON}/api/versions.json`);
const version = versions[0];
if (!version) throw new Error('no Data Dragon version');
console.log(`Data Dragon version ${version}`);

type ChampionFile = { data: Record<string, DDragonChampion> };
const en = await getJson<ChampionFile>(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`);
const fr = await getJson<ChampionFile>(`${DDRAGON}/cdn/${version}/data/fr_FR/champion.json`);

const champions: ChampionBase[] = Object.values(en.data)
  .map((c) => ({
    id: c.id,
    name: fr.data[c.id]?.name ?? c.name,
    image: c.image.full,
    tags: c.tags,
  }))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

await Bun.write(join(DATA_DIR, 'champions.json'), JSON.stringify(champions, null, 2) + '\n');
console.log(`champions.json: ${champions.length} champions`);

await mkdir(join(ASSETS_DIR, 'champions'), { recursive: true });
await mkdir(join(ASSETS_DIR, 'roles'), { recursive: true });

await pool(champions, 8, (c) =>
  download(`${DDRAGON}/cdn/${version}/img/champion/${c.image}`, join(ASSETS_DIR, 'champions', `${c.id}.png`)),
);
console.log(`downloaded ${champions.length} champion squares`);

for (const [role, icon] of Object.entries(ROLE_ICONS)) {
  await download(
    `${CDRAGON}/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-${icon}.png`,
    join(ASSETS_DIR, 'roles', `${role}.png`),
  );
}
console.log('downloaded 5 role icons');

await download(`${CDRAGON}/game/assets/maps/info/map11/2dlevelminimap_base_baron1.png`, join(ASSETS_DIR, 'minimap.png'));
console.log('downloaded minimap');
