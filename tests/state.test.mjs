import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { SCHEMA, StateError, migrateState, readState, withState, writeState } from '../scripts/lib/state.mjs';

const CLI = fileURLToPath(new URL('../scripts/state.mjs', import.meta.url));

function project(t, state) {
  const root = mkdtempSync(join(tmpdir(), 'solokit-state-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (state !== undefined) {
    mkdirSync(join(root, '.project'), { recursive: true });
    writeFileSync(join(root, '.project', 'state.json'), typeof state === 'string' ? state : `${JSON.stringify(state, null, 2)}\n`);
  }
  return root;
}
const onDisk = root => JSON.parse(readFileSync(join(root, '.project', 'state.json'), 'utf8'));
const base = () => ({ schema: SCHEMA, kit: { name: 'solo-agent-coding-kit', version: '0.1.0' }, phase: 'prd', steps: {} });

test('outside a solokit project the state reads as null', t => {
  assert.equal(readState(project(t)).state, null);
});

test('invalid JSON is an error that names the file', t => {
  const root = project(t, '{ nope');
  assert.throws(() => readState(root), error => error instanceof StateError && /\.project\/state\.json/.test(error.message));
});

test('an older schema is migrated step by step and reported', () => {
  const migrations = [
    { from: 0, to: 1, name: 'add steps', up: s => ({ ...s, steps: {} }) },
  ];
  const { state, migrated } = migrateState({ schema: 0, phase: 'prd' }, migrations, 1);
  assert.deepEqual(state, { schema: 1, phase: 'prd', steps: {} });
  assert.deepEqual(migrated, [{ from: 0, to: 1, name: 'add steps' }]);
});

test('a missing migration stops instead of skipping a schema', () => {
  assert.throws(() => migrateState({ schema: 0 }, [], 1), /no migration from schema 0/);
});

test('a project newer than the kit stops with an update hint', () => {
  assert.throws(() => migrateState({ schema: SCHEMA + 1 }, [], SCHEMA), /update solokit/);
});

test('readState writes a migrated state back before anything else', t => {
  const root = project(t, { schema: 0, phase: 'prd' });
  const migrations = [{ from: 0, to: 1, name: 'add steps', up: s => ({ ...s, steps: {} }) }];
  const { state, migrated } = readState(root, { migrations, schema: 1 });
  assert.equal(migrated.length, 1);
  assert.deepEqual(onDisk(root), state);
});

test('writeState writes formatted JSON with a trailing newline', t => {
  const root = project(t);
  writeState(root, base());
  const text = readFileSync(join(root, '.project', 'state.json'), 'utf8');
  assert.equal(text, `${JSON.stringify(base(), null, 2)}\n`);
});

test('withState reads first and writes the body result last', async t => {
  const root = project(t, base());
  const result = await withState(root, 'kickoff.card', state => ({ ...state, phase: 'bootstrap', steps: { ...state.steps, 'kickoff.card': 'done' } }));
  assert.equal(result.phase, 'bootstrap');
  assert.equal(onDisk(root).phase, 'bootstrap');
  assert.equal(onDisk(root).steps['kickoff.card'], 'done');
});

test('a failing body leaves the state as it was and marks the step failed with reason and recovery', async t => {
  const before = { ...base(), steps: { 'kickoff.card': 'done' }, failures: { 'old.step': { reason: 'x', recovery: 'y', at: 'z' } } };
  const root = project(t, before);
  const error = Object.assign(new Error('gh is not logged in'), { recovery: 'Run `gh auth login`, then run the command again.' });
  await assert.rejects(
    withState(root, 'bootstrap.remote', state => { state.phase = 'half-done'; throw error; }),
    /gh is not logged in/,
  );
  const after = onDisk(root);
  assert.equal(after.phase, 'prd');
  assert.equal(after.steps['kickoff.card'], 'done');
  assert.equal(after.steps['bootstrap.remote'], 'failed');
  assert.equal(after.failures['bootstrap.remote'].reason, 'gh is not logged in');
  assert.equal(after.failures['bootstrap.remote'].recovery, 'Run `gh auth login`, then run the command again.');
  assert.ok(after.failures['bootstrap.remote'].at);
  assert.deepEqual(after.failures['old.step'], before.failures['old.step']);
});

test('a step that succeeds clears its earlier failure', async t => {
  const root = project(t, { ...base(), steps: { 'bootstrap.remote': 'failed' }, failures: { 'bootstrap.remote': { reason: 'r', recovery: 'x', at: 't' } } });
  await withState(root, 'bootstrap.remote', state => ({ ...state, steps: { ...state.steps, 'bootstrap.remote': 'done' } }));
  assert.equal(onDisk(root).steps['bootstrap.remote'], 'done');
  assert.equal(onDisk(root).failures?.['bootstrap.remote'], undefined);
});

function cli(root, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });
  return { status: r.status, out: JSON.parse(r.stdout) };
}

test('state.mjs read prints the state, or null outside a project', t => {
  const root = project(t, base());
  assert.deepEqual(cli(root, 'read').out, { ok: true, result: { state: base(), migrated: [] } });
  assert.deepEqual(cli(project(t), 'read').out, { ok: true, result: { state: null, migrated: [] } });
});

test('state.mjs patch applies a JSON merge patch; --dry-run writes nothing', t => {
  const root = project(t, base());
  const dry = cli(root, 'patch', '--json', '{"phase":"bootstrap"}', '--dry-run');
  assert.equal(dry.out.result.state.phase, 'bootstrap');
  assert.equal(onDisk(root).phase, 'prd');
  const real = cli(root, 'patch', '--json', '{"phase":"bootstrap","steps":{"x":"done"},"failures":null}');
  assert.equal(real.status, 0);
  assert.equal(onDisk(root).phase, 'bootstrap');
  assert.equal(onDisk(root).steps.x, 'done');
  assert.equal('failures' in onDisk(root), false);
});

test('state.mjs patch outside a project fails', t => {
  const r = cli(project(t), 'patch', '--json', '{}');
  assert.equal(r.status, 1);
  assert.match(r.out.error, /no \.project\/state\.json/);
});

test('state.mjs fail-step records the failure without touching the rest', t => {
  const root = project(t, base());
  const r = cli(root, 'fail-step', 'plan.issues', '--reason', 'API rate limit', '--recovery', 'Wait an hour and run /solokit:plan again.');
  assert.equal(r.status, 0);
  assert.equal(onDisk(root).steps['plan.issues'], 'failed');
  assert.equal(onDisk(root).failures['plan.issues'].recovery, 'Wait an hour and run /solokit:plan again.');
  assert.equal(onDisk(root).phase, 'prd');
  assert.equal(existsSync(join(root, '.project', 'state.json')), true);
});
