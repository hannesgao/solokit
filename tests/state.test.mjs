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
  assert.equal(result.state.phase, 'bootstrap');
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

// Review follow-ups.

test('a body that writes the state and then throws still leaves the state as it was before the step', async t => {
  const root = project(t, base());
  await assert.rejects(withState(root, 'x', state => { writeState(root, { ...state, phase: 'half-done' }); throw new Error('boom'); }));
  assert.equal(onDisk(root).phase, 'prd');
  assert.equal(onDisk(root).steps.x, 'failed');
});

test('when recording the failure fails, the original error still surfaces', async t => {
  const root = project(t, base());
  const error = await withState(root, 'x', () => {
    rmSync(join(root, '.project'), { recursive: true, force: true });
    writeFileSync(join(root, '.project'), 'not a directory');
    throw new Error('original cause');
  }).catch(e => e);
  assert.equal(error.message, 'original cause');
  assert.ok(error.failureNotRecorded);
});

test('a body that returns nothing marks the step failed', async t => {
  const root = project(t, base());
  await assert.rejects(withState(root, 'x', () => undefined), /must return the state/);
  assert.equal(onDisk(root).steps.x, 'failed');
});

test('withState reports a migration and carries the recovery on the error', async t => {
  const root = project(t, { schema: 0, phase: 'prd' });
  const migrations = [{ from: 0, to: 1, name: 'add steps', up: s => ({ ...s, steps: {} }) }];
  const ok = await withState(root, 'x', s => s, { migrations, schema: 1 });
  assert.deepEqual(ok.migrated, [{ from: 0, to: 1, name: 'add steps' }]);
  assert.equal(ok.state.steps.x, 'done');
  const error = await withState(root, 'y', () => { throw new Error('nope'); }, { migrations, schema: 1 }).catch(e => e);
  assert.match(error.recovery, /run the command again/);
});

test('a step that succeeds without setting its status becomes done and its failure is cleared', async t => {
  const root = project(t, { ...base(), steps: { x: 'failed' }, failures: { x: { reason: 'r', recovery: 'v', at: 't' } } });
  await withState(root, 'x', s => s);
  assert.equal(onDisk(root).steps.x, 'done');
  assert.equal('failures' in onDisk(root), false);
});

test('a migration that throws names the migration; a migration that skips a schema is refused', () => {
  assert.throws(() => migrateState({ schema: 0 }, [{ from: 0, to: 1, name: 'add steps', up: () => { throw new Error('bad'); } }], 1), /migration 0→1 "add steps" failed: bad/);
  assert.throws(() => migrateState({ schema: 0 }, [{ from: 0, to: 2, name: 'jump', up: s => s }], 2), /must go from 0 to 1/);
});

test('a state file whose root is not an object is an error', t => {
  for (const text of ['null', '[]', '3']) {
    assert.throws(() => readState(project(t, text)), /must be a JSON object/);
  }
});

test('other read errors are not mistaken for a missing project', t => {
  const root = project(t);
  mkdirSync(join(root, '.project', 'state.json'), { recursive: true });
  assert.throws(() => readState(root), /EISDIR/);
});

test('readState with write: false migrates in memory only', t => {
  const root = project(t, { schema: 0, phase: 'prd' });
  const migrations = [{ from: 0, to: 1, name: 'add steps', up: s => ({ ...s, steps: {} }) }];
  readState(root, { migrations, schema: 1, write: false });
  assert.equal(onDisk(root).schema, 0);
});

test('state.mjs patch refuses a root that is not an object, a schema change and __proto__', t => {
  const root = project(t, base());
  for (const json of ['null', '[]', '"x"', '{"schema":2}', '{"__proto__":{"a":1}}']) {
    const r = cli(root, 'patch', '--json', json);
    assert.equal(r.status, 2, json);
  }
  assert.deepEqual(onDisk(root), base());
});

test('state.mjs patch replaces arrays and deletes with null below the root', t => {
  const root = project(t, { ...base(), list: [1, 2], nested: { a: 1, b: 2 } });
  cli(root, 'patch', '--json', '{"list":[3],"nested":{"a":null}}');
  assert.deepEqual(onDisk(root).list, [3]);
  assert.deepEqual(onDisk(root).nested, { b: 2 });
});

test('state.mjs takes --project and refuses an unsubstituted one', t => {
  const root = project(t, base());
  const elsewhere = project(t);
  const r = spawnSync(process.execPath, [CLI, 'read', '--project', root], { cwd: elsewhere, encoding: 'utf8' });
  assert.equal(JSON.parse(r.stdout).result.state.phase, 'prd');
  const bad = spawnSync(process.execPath, [CLI, 'read', '--project', '${CLAUDE_PROJECT_DIR}'], { cwd: elsewhere, encoding: 'utf8' });
  assert.equal(bad.status, 2);
});

test('state.mjs fail-step prints the recovery; usage errors exit 2; dry-run checks the project', t => {
  const root = project(t, base());
  const r = cli(root, 'fail-step', 'x', '--reason', 'r', '--recovery', 'Do this.');
  assert.equal(r.out.result.recovery, 'Do this.');
  assert.equal(cli(root, 'fail-step', 'x').status, 2);
  assert.equal(cli(project(t), 'fail-step', 'x', '--reason', 'r', '--recovery', 'v', '--dry-run').status, 1);
});

test('a failed command prints its recovery next to the error', t => {
  const r = cli(project(t), 'patch', '--json', '{}');
  assert.equal(r.status, 1);
  assert.ok(r.out.recovery);
});
