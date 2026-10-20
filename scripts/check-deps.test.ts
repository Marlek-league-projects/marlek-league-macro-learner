import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDeps } from './check-deps';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'check-deps-'));
  dirs.push(root);
  const all = { 'packages/data/src/contracts/index.ts': 'export interface Rules { a: 1 }\n', ...files };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

test('engine importing a data type from the root is reported', () => {
  const root = tree({ 'packages/engine/src/a.ts': "import { Rules } from '@lml/data';\n" });
  const errors = checkDeps(root);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain('must import @lml/data/contracts');
});

test('engine import type from the data root is reported', () => {
  const root = tree({ 'packages/engine/src/a.ts': "import type { Foo } from '@lml/data';\n" });
  expect(checkDeps(root)[0]).toContain('must import @lml/data/contracts');
});

test('engine using data implementations and data contracts is allowed', () => {
  const root = tree({
    'packages/engine/src/a.ts':
      "import { buildGraph } from '@lml/data';\nimport type { Rules } from '@lml/data/contracts';\n",
  });
  expect(checkDeps(root)).toEqual([]);
});

test('web may import only contracts outside main.tsx', () => {
  const root = tree({
    'packages/web/src/a.ts': "import { x } from '@lml/engine';\nimport type { Rules } from '@lml/data/contracts';\nimport { y } from '@lml/data';\n",
    'packages/web/src/main.tsx': "import { x } from '@lml/engine';\n",
  });
  const errors = checkDeps(root);
  expect(errors).toHaveLength(2);
  expect(errors.every((e) => e.includes('packages/web/src/a.ts'))).toBe(true);
});

test('data importing engine contracts is reported', () => {
  const root = tree({ 'packages/data/src/a.ts': "import type { X } from '@lml/engine/contracts';\n" });
  expect(checkDeps(root)[0]).toContain('forbidden import @lml/engine/contracts');
});

test('engine importing preact or touching window is reported', () => {
  const root = tree({ 'packages/engine/src/a.ts': "import { h } from 'preact';\nwindow.x = 1;\n" });
  expect(checkDeps(root)).toHaveLength(2);
});

test('the real repository passes', () => {
  expect(checkDeps('.')).toEqual([]);
});
