// Remembered answers for skills (CORE-2, CFG-4).
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/defaults.mjs --data ${CLAUDE_PLUGIN_DATA} get [key]
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/defaults.mjs --data ${CLAUDE_PLUGIN_DATA} set key=value … [--dry-run]
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/defaults.mjs --data ${CLAUDE_PLUGIN_DATA} list
import { CliError, main } from './lib/cli.mjs';
import { PREFERENCE_KEYS, readDefaults, writeDefaults } from './lib/defaults.mjs';

function checkKey(key) {
  if (!PREFERENCE_KEYS.includes(key)) {
    throw new CliError(`only preference answers are remembered (${PREFERENCE_KEYS.join(', ')}); "${key}" is not one`);
  }
}

main({ data: true }, cli => {
  const [command, ...rest] = cli.positionals;
  const defaults = readDefaults(cli.data);
  if (command === 'list') return defaults;
  if (command === 'get') {
    if (rest.length !== 1) throw new CliError('get needs one key');
    checkKey(rest[0]);
    return { [rest[0]]: defaults[rest[0]] ?? null };
  }
  if (command === 'set') {
    if (!rest.length) throw new CliError('set needs key=value pairs');
    const changes = {};
    for (const pair of rest) {
      const at = pair.indexOf('=');
      if (at < 1) throw new CliError(`expected key=value, got ${JSON.stringify(pair)}`);
      const key = pair.slice(0, at);
      checkKey(key);
      changes[key] = pair.slice(at + 1);
    }
    if (!cli.dryRun) writeDefaults(cli.data, { ...defaults, ...changes });
    return changes;
  }
  throw new CliError('usage: defaults.mjs --data <dir> get <key> | set key=value… | list');
});
