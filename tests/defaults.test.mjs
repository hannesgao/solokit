import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const CLI = fileURLToPath(new URL('../scripts/defaults.mjs', import.meta.url));

function data(t) {
  const dir = mkdtempSync(join(tmpdir(), 'solokit-data-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const run = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: r.status, out: JSON.parse(r.stdout) };
};

test('set, get and list remembered answers', t => {
  const dir = data(t);
  assert.equal(run('--data', dir, 'set', 'owner=acme', 'stack=node').status, 0);
  assert.deepEqual(run('--data', dir, 'get', 'owner').out.result, { owner: 'acme' });
  assert.deepEqual(run('--data', dir, 'list').out.result, { owner: 'acme', stack: 'node' });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'defaults.json'), 'utf8')), { owner: 'acme', stack: 'node' });
  assert.deepEqual(readdirSync(dir), ['defaults.json']);
});

test('nothing remembered yet reads as empty', t => {
  assert.deepEqual(run('--data', data(t), 'list').out.result, {});
  assert.deepEqual(run('--data', data(t), 'get', 'owner').out.result, { owner: null });
});

test('only preference keys can be remembered', t => {
  const dir = data(t);
  for (const pair of ['class=feature', 'approve=yes', 'version=1.2.0']) {
    assert.equal(run('--data', dir, 'set', pair).status, 2, pair);
  }
  assert.equal(run('--data', dir, 'set', 'owner').status, 2);
});

test('--data is required and must be absolute; dry run writes nothing', t => {
  assert.equal(run('list').status, 2);
  assert.equal(run('--data', 'relative', 'list').status, 2);
  const dir = data(t);
  const dry = run('--data', dir, 'set', 'owner=acme', '--dry-run');
  assert.deepEqual(dry.out.result, { owner: 'acme' });
  assert.deepEqual(readdirSync(dir), []);
});

test('values are validated per key', t => {
  const dir = data(t);
  for (const pair of ['visibility=foo', 'stack=cobol', 'language=English', 'owner=bad owner!']) {
    assert.equal(run('--data', dir, 'set', pair).status, 2, pair);
  }
  assert.equal(run('--data', dir, 'set', 'visibility=private', 'stack=generic', 'language=de', 'owner=acme-org').status, 0);
});

test('list and get show only preference keys with string values', t => {
  const dir = data(t);
  writeFileSync(join(dir, 'defaults.json'), JSON.stringify({ owner: 'acme', class: 'feature', stack: { x: 1 } }));
  assert.deepEqual(run('--data', dir, 'list').out.result, { owner: 'acme' });
});

test('a corrupt defaults.json is reported, not silently overwritten', t => {
  const dir = data(t);
  writeFileSync(join(dir, 'defaults.json'), '{ broken');
  const listed = run('--data', dir, 'list');
  assert.equal(listed.status, 1);
  assert.ok(listed.out.recovery);
  assert.equal(run('--data', dir, 'set', 'owner=acme').status, 1);
  assert.equal(readFileSync(join(dir, 'defaults.json'), 'utf8'), '{ broken');
});
