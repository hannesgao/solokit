// Shared command-line conventions for kit scripts (CFG-4, PRD "Technical
// architecture"): options parsed with node:util, the plugin data directory
// only from `--data`, `--dry-run` everywhere, one JSON result on stdout.
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

export class CliError extends Error {}

// Parses argv for a script. `spec.options` are node:util parseArgs options;
// `spec.data: true` makes `--data <dir>` required. The data directory is never
// taken from the environment: skill-run commands do not get it there (ADR 0002).
export function parseCli(argv, spec = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        ...spec.options,
        'dry-run': { type: 'boolean', default: false },
        ...(spec.data ? { data: { type: 'string' } } : {}),
      },
    });
  } catch (error) {
    throw new CliError(error.message);
  }
  const { 'dry-run': dryRun, data, ...values } = parsed.values;
  if (spec.data && !data) throw new CliError('missing --data <dir>: pass ${CLAUDE_PLUGIN_DATA} from the skill text');
  return { values, positionals: parsed.positionals, dryRun, data: data ? resolve(data) : undefined };
}

// Runs a script body and prints `{ ok: true, result }`, or `{ ok: false, error }`
// with exit code 2 for bad input and 1 for any other failure.
export async function main(spec, body, argv = process.argv.slice(2)) {
  try {
    const result = await body(parseCli(argv, spec));
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = error instanceof CliError ? 2 : 1;
  }
}
