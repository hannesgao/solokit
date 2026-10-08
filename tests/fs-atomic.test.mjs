import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { writeFileAtomic } from '../scripts/lib/fs-atomic.mjs';

const sandbox = () => mkdtempSync(join(tmpdir(), 'solokit-atomic-'));

test('writes the content and leaves no temp file', t => {
  const dir = sandbox();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'nested', 'a.json');
  writeFileAtomic(file, '{"a":1}\n');
  assert.equal(readFileSync(file, 'utf8'), '{"a":1}\n');
  assert.deepEqual(readdirSync(join(dir, 'nested')), ['a.json']);
});

test('a failure before the rename keeps the old content and removes the temp file', t => {
  const dir = sandbox();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'a.json');
  writeFileSync(file, 'old\n');
  assert.throws(
    () => writeFileAtomic(file, 'new\n', { beforeRename: () => { throw new Error('disk full'); } }),
    /disk full/,
  );
  assert.equal(readFileSync(file, 'utf8'), 'old\n');
  assert.deepEqual(readdirSync(dir), ['a.json']);
});
