// Production build: the HTML entry bundled with Tailwind, plus the static images under public/.
import { cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import tailwind from 'bun-plugin-tailwind';

const dir = import.meta.dir;
const dist = join(dir, 'dist');

await rm(dist, { recursive: true, force: true });
const result = await Bun.build({ entrypoints: [join(dir, 'index.html')], outdir: dist, minify: true, plugins: [tailwind] });
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
await cp(join(dir, 'public/assets'), join(dist, 'assets'), { recursive: true });
