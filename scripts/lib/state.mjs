// .project/state.json: read first, write last (CORE-1), never half-written
// (CORE-7). Every kit command goes through withState or these helpers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { migrations as kitMigrations } from '../../migrations/index.mjs';
import { writeFileAtomic } from './fs-atomic.mjs';

export const SCHEMA = 1;
export const STATE_FILE = '.project/state.json';

export class StateError extends Error {}

const statePath = root => join(root, STATE_FILE);
const now = () => new Date().toISOString();

// Applies migrations until `state.schema` equals `target`, one schema at a
// time, and reports each one. A missing step or a newer project stops.
export function migrateState(state, migrations = kitMigrations, target = SCHEMA) {
  const migrated = [];
  let current = state;
  const from = current.schema ?? 0;
  if (from > target) {
    throw new StateError(`${STATE_FILE} has schema ${from}, newer than this kit's ${target}: update solokit before running it here`);
  }
  while ((current.schema ?? 0) < target) {
    const at = current.schema ?? 0;
    const step = migrations.find(m => m.from === at);
    if (!step) throw new StateError(`no migration from schema ${at} to ${at + 1}`);
    current = { ...step.up(structuredClone(current)), schema: step.to };
    migrated.push({ from: step.from, to: step.to, name: step.name });
  }
  return { state: current, migrated };
}

// Reads the state; `{ state: null }` outside a solokit project. A migrated
// state is written back at once, so nothing runs on an old schema.
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
  const result = migrateState(parsed, options.migrations, options.schema);
  if (result.migrated.length) writeState(root, result.state);
  return result;
}

export function writeState(root, state) {
  writeFileAtomic(statePath(root), `${JSON.stringify(state, null, 2)}\n`);
}

// Marks `step` failed with the reason and how to recover; leaves the rest.
export function failStep(root, step, reason, recovery) {
  const { state } = readState(root);
  if (!state) throw new StateError(`no ${STATE_FILE} here: not a solokit project`);
  state.steps = { ...state.steps, [step]: 'failed' };
  state.failures = { ...state.failures, [step]: { reason, recovery, at: now() } };
  writeState(root, state);
  return state;
}

// Reads the state first, runs `body(state)`, writes its result last. A body
// that throws leaves the state as it was, except that `step` is marked failed
// with the error's message and its `recovery` (or a generic hint); the error
// is re-thrown. A step that succeeds clears its earlier failure.
export async function withState(root, step, body, options = {}) {
  const { state } = readState(root, options);
  if (!state) throw new StateError(`no ${STATE_FILE} here: not a solokit project`);
  let next;
  try {
    next = await body(structuredClone(state));
  } catch (error) {
    const recovery = error.recovery ?? `Fix the cause, then run the command again; step "${step}" resumes from the start.`;
    failStep(root, step, error.message, recovery);
    throw error;
  }
  if (next.failures?.[step] && next.steps?.[step] !== 'failed') {
    const { [step]: _, ...rest } = next.failures;
    next.failures = rest;
    if (!Object.keys(rest).length) delete next.failures;
  }
  writeState(root, next);
  return next;
}
