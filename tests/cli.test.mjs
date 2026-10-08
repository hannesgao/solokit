import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { test } from 'node:test';

import { CliError, parseCli } from '../scripts/lib/cli.mjs';

test('parseCli returns options, positionals and the dry-run flag', () => {
  const cli = parseCli(['get', 'owner', '--dry-run'], { options: {} });
  assert.deepEqual(cli.positionals, ['get', 'owner']);
  assert.equal(cli.dryRun, true);
});

test('--data resolves to an absolute path', () => {
  const cli = parseCli(['--data', 'some/dir'], { data: true });
  assert.ok(isAbsolute(cli.data));
  assert.ok(cli.data.endsWith(join('some', 'dir')));
});

test('a script that needs --data fails without it, even when CLAUDE_PLUGIN_DATA is set', () => {
  const before = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = '/tmp/should-not-be-used';
  try {
    assert.throws(() => parseCli([], { data: true }), error => error instanceof CliError && /--data/.test(error.message));
  } finally {
    if (before === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = before;
  }
});

test('unknown options are rejected', () => {
  assert.throws(() => parseCli(['--nope'], { options: {} }), CliError);
});

test('main prints one JSON result, and a JSON error with exit code 2 on bad input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'solokit-cli-'));
  const script = join(dir, 'echo.mjs');
  const lib = new URL('../scripts/lib/cli.mjs', import.meta.url).href;
  writeFileSync(script, `import { main } from ${JSON.stringify(lib)};
main({ data: true }, cli => ({ data: cli.data, dryRun: cli.dryRun }));
`);
  const ok = spawnSync(process.execPath, [script, '--data', dir, '--dry-run'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { ok: true, result: { data: dir, dryRun: true } });

  const bad = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  const error = JSON.parse(bad.stdout);
  assert.equal(error.ok, false);
  assert.match(error.error, /--data/);
});
