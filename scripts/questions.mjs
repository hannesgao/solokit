// Builds the next multiple-choice round for a skill (CORE-2).
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/questions.mjs build --data ${CLAUDE_PLUGIN_DATA} --spec '<json array>' [--flags '<json>'] [--config '<json>'] [--checks-passed]
// Returns { questions, ask, answered, warnings? }: the skill passes `ask` to
// AskUserQuestion, maps the chosen label back through `questions`, and uses
// `answered` as is. `--config` holds userConfig values (`${user_config.KEY}`);
// values equal to the manifest's defaults count as not set.
import { readFileSync } from 'node:fs';

import { CliError, main } from './lib/cli.mjs';
import { DefaultsError, readDefaults } from './lib/defaults.mjs';
import { QuestionError, buildRound } from './lib/questions.mjs';

function json(name, text, fallback) {
  if (text === undefined) return fallback;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`--${name} is not valid JSON: ${error.message}`);
  }
}

function manifestDefaults() {
  const manifest = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  return Object.fromEntries(Object.entries(manifest.userConfig ?? {}).map(([key, field]) => [key, field.default]));
}

const spec = {
  data: true,
  options: {
    spec: { type: 'string' },
    flags: { type: 'string' },
    config: { type: 'string' },
    'checks-passed': { type: 'boolean', default: false },
  },
};

main(spec, cli => {
  if (cli.positionals[0] !== 'build') throw new CliError('usage: questions.mjs build --data <dir> --spec <json> [--flags <json>] [--config <json>] [--checks-passed]');
  const specs = json('spec', cli.values.spec, undefined);
  if (specs === undefined) throw new CliError('build needs --spec');
  const warnings = [];
  let remembered = {};
  try {
    remembered = readDefaults(cli.data);
  } catch (error) {
    if (!(error instanceof DefaultsError)) throw error;
    warnings.push(`${error.message}; remembered answers ignored. ${error.recovery}`);
  }
  try {
    const round = buildRound(specs, {
      flags: json('flags', cli.values.flags, {}),
      config: json('config', cli.values.config, {}),
      configDefaults: manifestDefaults(),
      remembered,
      checksPassed: cli.values['checks-passed'],
    });
    return warnings.length ? { ...round, warnings } : round;
  } catch (error) {
    throw error instanceof QuestionError ? new CliError(error.message) : error;
  }
});
