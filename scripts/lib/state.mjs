// .project/state.json: read first, write last (CORE-1), never half-written
// (CORE-7). Every kit command goes through withState or these helpers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { migrations as kitMigrations } from '../../migrations/index.mjs';
import { writeFileAtomic } from './fs-atomic.mjs';

export const SCHEMA = 1;
export const STATE_FILE = '.project/state.json';

export class StateError extends Error {
  constructor(message, recovery) {
    super(message);
    if (recovery) this.recovery = recovery;
  }
}

const statePath = root => join(root, STATE_FILE);
const now = () => new Date().toISOString();
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export const notAProject = () =>
  new StateError(`no ${STATE_FILE} here: not a solokit project`, 'Run /solokit:go in the project folder to start or import a project.');

// Applies migrations until `state.schema` equals `target`, one schema at a
// time, and reports each one. A missing or skipping step, a failing
// migration or a project newer than the kit stops.
export function migrateState(state, migrations = kitMigrations, target = SCHEMA) {
  const migrated = [];
  let current = state;
  const from = current.schema ?? 0;
  if (from > target) {
    throw new StateError(`${STATE_FILE} has schema ${from}, newer than this kit's ${target}: update solokit`, 'Update solokit before running it in this project.');
  }
  while ((current.schema ?? 0) < target) {
    const at = current.schema ?? 0;
    const step = migrations.find(m => m.from === at);
    if (!step) throw new StateError(`no migration from schema ${at} to ${at + 1}`);
    if (step.to !== at + 1) throw new StateError(`migration "${step.name}" must go from ${at} to ${at + 1}, not to ${step.to}`);
    try {
      current = { ...step.up(structuredClone(current)), schema: step.to };
    } catch (error) {
      throw new StateError(`migration ${step.from}→${step.to} "${step.name}" failed: ${error.message}`);
    }
    migrated.push({ from: step.from, to: step.to, name: step.name });
  }
  return { state: current, migrated };
}

// Reads the state; `{ state: null }` outside a solokit project. A migrated
// state is written back at once, so nothing runs on an old schema, unless
// `options.write` is false (read-only callers and dry runs).
export function readState(root, options = {}) {
  let text;
  try {
    text = readFileSync(statePath(root), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { state: null, migrated: [] };
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new StateError(`${STATE_FILE} is not valid JSON: ${error.message}`);
  }
  if (!isObject(parsed)) throw new StateError(`${STATE_FILE} must be a JSON object`);
  const result = migrateState(parsed, options.migrations, options.schema);
  if (result.migrated.length && options.write !== false) writeState(root, result.state);
  return result;
}

export function writeState(root, state) {
  if (!isObject(state)) throw new StateError('the state to write must be a JSON object');
  writeFileAtomic(statePath(root), `${JSON.stringify(state, null, 2)}\n`);
}

// `state` with `step` marked failed, its reason and how to recover.
function withFailure(state, step, reason, recovery) {
  return {
    ...state,
    steps: { ...state.steps, [step]: 'failed' },
    failures: { ...state.failures, [step]: { reason, recovery, at: now() } },
  };
}

// Marks `step` failed with the reason and how to recover; leaves the rest.
export function failStep(root, step, reason, recovery, options = {}) {
  const { state, migrated } = readState(root, options);
  if (!state) throw notAProject();
  const next = withFailure(state, step, reason, recovery);
  if (options.write !== false) writeState(root, next);
  return { state: next, migrated };
}

// Reads the state first (migrating it), runs `body(state)`, writes its result
// last and returns `{ state, migrated }`. A step that ends without a status of
// its own is `done`, and its earlier failure is cleared.
//
// If anything after the read fails, the file is restored to the state as read
// with `step` marked failed, the error gets a `recovery` and is re-thrown. If
// even that write fails, the original error is re-thrown with
// `failureNotRecorded` set to the second error.
export async function withState(root, step, body, options = {}) {
  const { state: before, migrated } = readState(root, options);
  if (!before) throw notAProject();
  try {
    const next = await body(structuredClone(before));
    if (!isObject(next)) throw new StateError(`step "${step}" must return the state object`);
    if (next.steps?.[step] === undefined || next.steps[step] === 'failed') next.steps = { ...next.steps, [step]: 'done' };
    if (next.failures?.[step]) {
      const { [step]: _, ...rest } = next.failures;
      next.failures = rest;
      if (!Object.keys(rest).length) delete next.failures;
    }
    writeState(root, next);
    return { state: next, migrated };
  } catch (error) {
    error.recovery ??= `Fix the cause, then run the command again; step "${step}" starts over.`;
    try {
      writeState(root, withFailure(before, step, error.message, error.recovery));
    } catch (recordError) {
      error.failureNotRecorded = recordError;
    }
    throw error;
  }
}
