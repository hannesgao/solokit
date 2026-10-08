import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { SCHEMA, writeState } from '../scripts/lib/state.mjs';
import { runSteps } from '../scripts/lib/steps.mjs';

function project(t, state) {
  const root = mkdtempSync(join(tmpdir(), 'solokit-steps-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (state) writeState(root, state);
  return root;
}
const base = (steps = {}) => ({ schema: SCHEMA, phase: 'bootstrap', steps });
const onDisk = root => JSON.parse(readFileSync(join(root, '.project', 'state.json'), 'utf8'));

// A step whose outcome is a file in the project.
function fileStep(root, name, calls) {
  const path = join(root, `${name}.txt`);
  return {
    name,
    check: () => existsSync(path),
    run: () => { calls.push(name); writeFileSync(path, name); },
  };
}

test('a step whose outcome exists is reported done and skipped, and the state catches up', async t => {
  const root = project(t, base());
  writeFileSync(join(root, 'a.txt'), 'a');
  const calls = [];
  const report = await runSteps(root, [fileStep(root, 'a', calls)]);
  assert.deepEqual(calls, []);
  assert.deepEqual(report.steps, [{ name: 'a', status: 'done', skipped: true }]);
  assert.equal(report.ok, true);
  assert.equal(onDisk(root).steps.a, 'done');
});

test('a step whose outcome is missing runs and is recorded done', async t => {
  const root = project(t, base());
  const calls = [];
  const report = await runSteps(root, [fileStep(root, 'a', calls), fileStep(root, 'b', calls)]);
  assert.deepEqual(calls, ['a', 'b']);
  assert.deepEqual(report.steps.map(s => s.status), ['done', 'done']);
  assert.deepEqual(onDisk(root).steps, { a: 'done', b: 'done' });
});

test('reality wins over the state: a step marked done whose outcome is gone runs again', async t => {
  const root = project(t, base({ a: 'done' }));
  const calls = [];
  const report = await runSteps(root, [fileStep(root, 'a', calls)]);
  assert.deepEqual(calls, ['a']);
  assert.match(report.steps[0].note, /state said done/);
});

test('a dry run checks every step and runs or writes nothing', async t => {
  const root = project(t, base());
  writeFileSync(join(root, 'a.txt'), 'a');
  const calls = [];
  const report = await runSteps(root, [fileStep(root, 'a', calls), fileStep(root, 'b', calls)], { dryRun: true });
  assert.deepEqual(calls, []);
  assert.deepEqual(report.steps.map(s => s.status), ['done', 'would run']);
  assert.deepEqual(onDisk(root).steps, {});
});

test('the first failure stops the run, later steps are not run, and the recovery is reported', async t => {
  const root = project(t, base());
  const calls = [];
  const failing = {
    name: 'b',
    check: () => false,
    run: () => { throw Object.assign(new Error('gh is not logged in'), { recovery: 'Run `gh auth login`.' }); },
  };
  const report = await runSteps(root, [fileStep(root, 'a', calls), failing, fileStep(root, 'c', calls)]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.steps.map(s => s.status), ['done', 'failed', 'not run']);
  assert.deepEqual(report.failed, { name: 'b', error: 'gh is not logged in', recovery: 'Run `gh auth login`.' });
  assert.deepEqual(calls, ['a']);
  assert.equal(onDisk(root).steps.b, 'failed');
  assert.equal(onDisk(root).steps.c, undefined);
});

test('a check that throws fails the step without running it', async t => {
  const root = project(t, base());
  let ran = false;
  const report = await runSteps(root, [{ name: 'x', check: () => { throw new Error('network down'); }, run: () => { ran = true; } }]);
  assert.equal(ran, false);
  assert.equal(report.failed.name, 'x');
  assert.match(report.failed.error, /network down/);
  assert.ok(report.failed.recovery);
  assert.equal(onDisk(root).steps.x, 'failed');
});

test('running the same steps twice skips everything the second time', async t => {
  const root = project(t, base());
  const calls = [];
  const steps = () => [fileStep(root, 'a', calls), fileStep(root, 'b', calls)];
  await runSteps(root, steps());
  const second = await runSteps(root, steps());
  assert.deepEqual(calls, ['a', 'b']);
  assert.ok(second.steps.every(s => s.skipped));
});

test('before state.json exists steps still run; bookkeeping starts once a step creates it', async t => {
  const root = project(t);
  const calls = [];
  const createState = {
    name: 'kickoff.state',
    check: () => existsSync(join(root, '.project', 'state.json')),
    run: () => { calls.push('kickoff.state'); writeState(root, base()); },
  };
  const report = await runSteps(root, [fileStep(root, 'pre', calls), createState, fileStep(root, 'post', calls)]);
  assert.equal(report.ok, true);
  assert.deepEqual(calls, ['pre', 'kickoff.state', 'post']);
  assert.equal(onDisk(root).steps.post, 'done');
  assert.equal(onDisk(root).steps['kickoff.state'], 'done');
});

test('a step without check is refused', async t => {
  const root = project(t, base());
  await assert.rejects(runSteps(root, [{ name: 'x', run: () => {} }]), /needs check and run/);
});

// Review follow-ups.

const migrations = [{ from: 0, to: 1, name: 'add steps', up: st => ({ ...st, steps: {} }) }];

test('a schema migration is reported, and a dry run migrates in memory only', async t => {
  const root = project(t, { schema: 0, phase: 'bootstrap' });
  const dry = await runSteps(root, [fileStep(root, 'a', [])], { dryRun: true, migrations, schema: 1 });
  assert.deepEqual(dry.migrated, [{ from: 0, to: 1, name: 'add steps' }]);
  assert.equal(onDisk(root).schema, 0);
  const real = await runSteps(root, [fileStep(root, 'a', [])], { migrations, schema: 1 });
  assert.deepEqual(real.migrated, [{ from: 0, to: 1, name: 'add steps' }]);
  assert.equal(onDisk(root).schema, 1);
});

test('a step that creates state.json and then fails is recorded failed, so the next run does not skip it', async t => {
  const root = project(t);
  const createThenFail = {
    name: 'kickoff.state',
    check: () => existsSync(join(root, '.project', 'state.json')) && onDisk(root).steps['kickoff.state'] === 'done',
    run: () => { writeState(root, base()); throw new Error('commit failed'); },
  };
  const report = await runSteps(root, [createThenFail]);
  assert.equal(report.ok, false);
  assert.equal(onDisk(root).steps['kickoff.state'], 'failed');
  assert.equal(onDisk(root).failures['kickoff.state'].reason, 'commit failed');
});

test('a step recorded failed whose outcome now exists is done, and the report says the failure was cleared', async t => {
  const root = project(t, { ...base({ a: 'failed' }), failures: { a: { reason: 'r', recovery: 'v', at: 't' } } });
  writeFileSync(join(root, 'a.txt'), 'a');
  const report = await runSteps(root, [fileStep(root, 'a', [])]);
  assert.match(report.steps[0].note, /earlier failure cleared/);
  assert.equal(onDisk(root).steps.a, 'done');
  assert.equal('failures' in onDisk(root), false);
});

test('a run that edits state.json itself keeps its edit', async t => {
  const root = project(t, base());
  const step = { name: 'a', check: () => false, run: () => writeState(root, { ...onDisk(root), phase: 'plan' }) };
  await runSteps(root, [step]);
  assert.equal(onDisk(root).phase, 'plan');
  assert.equal(onDisk(root).steps.a, 'done');
});

test('a check that throws during a dry run is reported but not recorded', async t => {
  const root = project(t, base());
  const report = await runSteps(root, [{ name: 'x', check: () => { throw new Error('offline'); }, run: () => {} }], { dryRun: true });
  assert.equal(report.failed.name, 'x');
  assert.equal(onDisk(root).steps.x, undefined);
});

test('an unreadable state.json is reported like any failure, not thrown', async t => {
  const root = project(t);
  writeState(root, base());
  writeFileSync(join(root, '.project', 'state.json'), '{ broken');
  const report = await runSteps(root, [fileStep(root, 'a', [])]);
  assert.equal(report.ok, false);
  assert.match(report.failed.error, /not valid JSON/);
  assert.ok(report.failed.recovery);
});

test('step names must be non-empty and unique', async t => {
  const root = project(t, base());
  const step = name => ({ name, check: () => true, run: () => {} });
  await assert.rejects(runSteps(root, [step('')]), /non-empty name/);
  await assert.rejects(runSteps(root, [step('a'), step('a')]), /duplicate step "a"/);
});

test('failed runs and failed checks give the same default recovery', async t => {
  const root = project(t, base());
  const a = await runSteps(root, [{ name: 'x', check: () => { throw new Error('e'); }, run: () => {} }]);
  const b = await runSteps(root, [{ name: 'x', check: () => false, run: () => { throw new Error('e'); } }]);
  assert.equal(a.failed.recovery, b.failed.recovery);
});
