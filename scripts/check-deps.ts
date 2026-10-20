// Enforces the one-way dependency rule: web → engine → data, and that
// cross-module types come from `@lml/<pkg>/contracts`. Relative imports must stay inside their package.
import { Glob } from 'bun';
import * as fs from 'node:fs';
import { join, posix } from 'node:path';

const FORBIDDEN: Record<string, RegExp[]> = {
  data: [/^@lml\/engine/, /^@lml\/web/, /^preact/, /^@preact\//],
  engine: [/^@lml\/web/, /^preact/, /^@preact\//],
  web: [],
};
const FORBIDDEN_GLOBALS: Record<string, RegExp> = { engine: /\b(document|window)\b/ };
const WEB_COMPOSITION_ROOT = 'packages/web/src/main.tsx';

const importRe =
  /(?:import|export)(\s+type)?\s*([^'"]*?)\sfrom\s*['"]([^'"]+)['"]|import\s*\(?\s*['"]([^'"]+)['"]/g;

/** Names exported as types by a package's contracts folder. */
function contractTypeNames(root: string, pkg: string): Set<string> {
  const names = new Set<string>();
  const re = /export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/g;
  for (const file of new Glob(`packages/${pkg}/src/contracts/**/*.ts`).scanSync(root)) {
    for (const m of fs.readFileSync(join(root, file), 'utf8').matchAll(re)) names.add(m[1]);
  }
  return names;
}

function importedNames(clause: string): string[] {
  const inner = clause.match(/\{([^}]*)\}/)?.[1] ?? '';
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0] ?? '')
    .filter(Boolean);
}

export function checkDeps(root: string = '.'): string[] {
  const errors: string[] = [];
  for (const pkg of Object.keys(FORBIDDEN)) {
    const typeNames: Record<string, Set<string>> = {};
    for (const file of new Glob(`packages/${pkg}/src/**/*.{ts,tsx}`).scanSync(root)) {
      const src = fs.readFileSync(join(root, file), 'utf8') as string;
      for (const m of src.matchAll(importRe)) {
        const typeOnly = !!m[1];
        const spec = m[3] ?? m[4] ?? '';
        if (spec.startsWith('.')) {
          const target = posix.normalize(posix.join(posix.dirname(file), spec));
          if (!target.startsWith(`packages/${pkg}/`)) errors.push(`${file}: relative import ${spec} leaves packages/${pkg}`);
          continue;
        }
        if (FORBIDDEN[pkg]!.some((r) => r.test(spec))) {
          errors.push(`${file}: forbidden import ${spec}`);
          continue;
        }
        const other = spec.match(/^@lml\/(data|engine|web)(\/.*)?$/);
        if (!other || other[1] === pkg) continue;
        const isContracts = other[2] === '/contracts';
        if (pkg === 'web') {
          if (!isContracts && file !== WEB_COMPOSITION_ROOT) errors.push(`${file}: must import ${spec}/contracts, not ${spec}`);
          continue;
        }
        if (isContracts || other[2]) continue;
        const names = importedNames(m[2] ?? '');
        const types = (typeNames[other[1]!] ??= contractTypeNames(root, other[1]!));
        const offending = typeOnly ? names.length ? names : ['*'] : names.filter((n) => types.has(n));
        if (offending.length) errors.push(`${file}: must import @lml/${other[1]}/contracts for types (${offending.join(', ')}), not ${spec}`);
      }
      const globals = FORBIDDEN_GLOBALS[pkg];
      if (globals) {
        const code = src.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
        const hit = code.match(globals);
        if (hit) errors.push(`${file}: forbidden global ${hit[0]}`);
      }
    }
  }
  return errors;
}

if (import.meta.main) {
  const errors = checkDeps('.');
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('check-deps: ok');
}
