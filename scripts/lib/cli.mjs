// Shared command-line conventions for kit scripts (CFG-4, PRD "Technical
// architecture"): options parsed with node:util, the plugin data directory
// only from `--data`, `--dry-run` everywhere, one JSON result on stdout.
import { isAbsolute } from 'node:path';
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
  if (spec.data) checkDataDir(data);
  return { values, positionals: parsed.positionals, dryRun, data };
}

// The data directory must arrive as an absolute path. A relative or empty
// value, or a `$` placeholder left unsubstituted, means the skill text did not
// pass ${CLAUDE_PLUGIN_DATA} through, and writing there would land in the
// working directory instead.
function checkDataDir(data) {
  if (data === undefined) throw new CliError('missing --data <dir>: pass ${CLAUDE_PLUGIN_DATA} from the skill text');
  if (data.includes('$') || !isAbsolute(data)) {
    throw new CliError(`--data must be the absolute plugin data directory, got ${JSON.stringify(data)}`);
  }
}

// Runs a script body and prints `{ ok: true, result }`, or `{ ok: false, error,
// recovery? }` with exit code 2 for bad input and 1 for any other failure; an
// error's `recovery` says how to get going again (CORE-7).
export async function main(spec, body, argv = process.argv.slice(2)) {
  try {
    const result = await body(parseCli(argv, spec));
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const recovery = error instanceof Error ? error.recovery : undefined;
    process.stdout.write(`${JSON.stringify({ ok: false, error: message, ...(recovery ? { recovery } : {}) })}\n`);
    process.exitCode = error instanceof CliError ? 2 : 1;
  }
}
