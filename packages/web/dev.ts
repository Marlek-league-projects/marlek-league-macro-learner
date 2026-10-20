// Dev server: the bundled page plus the static images under public/ (the HTML bundler does not serve them).
import { join, normalize } from 'node:path';
import index from './index.html';

const PUBLIC = join(import.meta.dir, 'public');

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: { hmr: true, console: true },
  routes: {
    '/': index,
    '/assets/*': async (req) => {
      const path = normalize(decodeURIComponent(new URL(req.url).pathname));
      const file = Bun.file(join(PUBLIC, path));
      if (!path.startsWith('/assets/') || !(await file.exists())) return new Response('Not found', { status: 404 });
      return new Response(file);
    },
  },
});

console.log(`League Macro Learner: ${server.url}`);
