// Reads and updates .project/state.json for skills (CORE-1, CORE-7).
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs read [--project <dir>]
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs patch --json '<JSON merge patch>' [--dry-run]
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs fail-step <step> --reason <text> --recovery <text> [--dry-run]
// Every result carries `migrated`, the schema migrations applied on the way.
import { resolve } from 'node:path';

import { CliError, main } from './lib/cli.mjs';
import { failStep, notAProject, readState, writeState } from './lib/state.mjs';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// RFC 7386 JSON merge patch: objects merge, null deletes, anything else
// (arrays included) replaces.
function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = mergePatch(out[key], value);
  }
  return out;
}

function parsePatch(json) {
  if (!json) throw new CliError('patch needs --json <merge patch>');
  let patch;
  try {
    patch = JSON.parse(json, (key, value) => {
      if (FORBIDDEN_KEYS.has(key)) throw new CliError(`--json may not contain the key "${key}"`);
      return value;
    });
  } catch (error) {
    throw error instanceof CliError ? error : new CliError(`--json is not valid JSON: ${error.message}`);
  }
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new CliError('--json must be a JSON object');
  if ('schema' in patch) throw new CliError('the schema changes only through migrations, not through patch');
  return patch;
}

function projectRoot(value) {
  if (value === undefined) return process.cwd();
  if (value === '' || value.includes('$')) throw new CliError(`--project must be a directory, got ${JSON.stringify(value)}`);
  return resolve(value);
}

const spec = {
  options: {
    json: { type: 'string' },
    reason: { type: 'string' },
    recovery: { type: 'string' },
    project: { type: 'string' },
  },
};

main(spec, cli => {
  const root = projectRoot(cli.values.project);
  const write = !cli.dryRun;
  const [command, step] = cli.positionals;
  if (command === 'read') return readState(root, { write: false });
  if (command === 'patch') {
    const patch = parsePatch(cli.values.json);
    const { state, migrated } = readState(root, { write });
    if (!state) throw notAProject();
    const next = mergePatch(state, patch);
    if (write) writeState(root, next);
    return { state: next, migrated, written: write };
  }
  if (command === 'fail-step') {
    const { reason, recovery } = cli.values;
    if (!step || !reason || !recovery) throw new CliError('fail-step needs <step> --reason <text> --recovery <text>');
    const { migrated } = failStep(root, step, reason, recovery, { write });
    return { step, reason, recovery, migrated, written: write };
  }
  throw new CliError('usage: state.mjs read | patch --json <patch> | fail-step <step> --reason <text> --recovery <text>');
});
