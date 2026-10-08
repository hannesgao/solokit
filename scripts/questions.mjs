// Builds the next multiple-choice round for a skill (CORE-2).
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/questions.mjs build --data ${CLAUDE_PLUGIN_DATA} --spec '<json array>' [--flags '<json>'] [--config '<json>'] [--checks-passed]
// Returns { questions, answered }; the skill asks `questions` with
// AskUserQuestion (dropping `id`, `value` and `more`) and uses `answered` as is.
import { CliError, main } from './lib/cli.mjs';
import { readDefaults } from './lib/defaults.mjs';
import { QuestionError, buildRound } from './lib/questions.mjs';

function json(name, text, fallback) {
  if (text === undefined) return fallback;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`--${name} is not valid JSON: ${error.message}`);
  }
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
  if (!specs) throw new CliError('build needs --spec');
  try {
    return buildRound(specs, {
      flags: json('flags', cli.values.flags, {}),
      config: json('config', cli.values.config, {}),
      remembered: readDefaults(cli.data),
      checksPassed: cli.values['checks-passed'],
    });
  } catch (error) {
    throw error instanceof QuestionError ? new CliError(error.message) : error;
  }
});
