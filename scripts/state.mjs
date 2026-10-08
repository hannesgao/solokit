// Reads and updates .project/state.json for skills (CORE-1, CORE-7).
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs read
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs patch --json '<JSON merge patch>' [--dry-run]
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs fail-step <step> --reason <text> --recovery <text>
import { CliError, main } from './lib/cli.mjs';
import { StateError, failStep, readState, writeState } from './lib/state.mjs';

// RFC 7386 JSON merge patch: objects merge, null deletes, anything else replaces.
function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = mergePatch(out[key], value);
  }
  return out;
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
  const root = cli.values.project ?? process.cwd();
  const [command, step] = cli.positionals;
  if (command === 'read') return readState(root);
  if (command === 'patch') {
    if (!cli.values.json) throw new CliError('patch needs --json <merge patch>');
    let patch;
    try {
      patch = JSON.parse(cli.values.json);
    } catch (error) {
      throw new CliError(`--json is not valid JSON: ${error.message}`);
    }
    const { state } = readState(root);
    if (!state) throw new StateError('no .project/state.json here: not a solokit project');
    const next = mergePatch(state, patch);
    if (!cli.dryRun) writeState(root, next);
    return { state: next, written: !cli.dryRun };
  }
  if (command === 'fail-step') {
    if (!step || !cli.values.reason || !cli.values.recovery) throw new CliError('fail-step needs <step> --reason <text> --recovery <text>');
    if (cli.dryRun) return { step, written: false };
    failStep(root, step, cli.values.reason, cli.values.recovery);
    return { step, written: true };
  }
  throw new CliError('usage: state.mjs read | patch --json <patch> | fail-step <step> --reason <text> --recovery <text>');
});
