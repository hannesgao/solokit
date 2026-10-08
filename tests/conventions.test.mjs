import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { checkConventions } from './lib/conventions.mjs';

const fixture = name => fileURLToPath(new URL(`./fixtures/conventions/${name}`, import.meta.url));
const rules = name => checkConventions(fixture(name)).map(v => v.rule);

test('a compliant plugin has no violations: list and CRLF frontmatter, injection form, agents, hooks reading their environment', () => {
  assert.deepEqual(checkConventions(fixture('good')), []);
});

test('CFG-4: a skill calls kit scripts only as node ${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs', () => {
  assert.deepEqual(rules('bad-call'), ['script-call']);
});

test('CFG-4: a skill that calls a kit script pre-approves it in allowed-tools', () => {
  assert.deepEqual(rules('bad-allowed'), ['allowed-tools']);
});

test('CFG-4: ${CLAUDE_PLUGIN_DATA} appears in a skill only as the --data argument', () => {
  assert.deepEqual(rules('bad-data'), ['data-arg']);
});

test('CFG-4: scripts never read the plugin data location from the environment', () => {
  assert.deepEqual(rules('bad-env'), ['data-env']);
});

test('CFG-3: scripts and hooks never handle GitHub tokens', () => {
  assert.deepEqual(rules('bad-token'), ['token']);
});

test('CFG-4: a skill calls a script file, not a library module', () => {
  assert.deepEqual(rules('bad-call-lib'), ['script-call']);
});

test('CFG-4: destructured and aliased environment reads are caught', () => {
  assert.deepEqual(rules('bad-env-destructure'), ['data-env', 'data-env']);
});

test('CFG-3: token flags and enterprise tokens are caught', () => {
  assert.deepEqual(rules('bad-token-flags'), ['token', 'token']);
});

test('CFG-4 (#82): every spelling of the data directory is caught', () => {
  assert.deepEqual(rules('bad-data-bare'), ['data-arg', 'data-arg']);
  assert.deepEqual(rules('bad-data-path'), ['data-arg', 'data-arg', 'data-arg', 'data-arg', 'data-arg', 'data-arg']);
});

test('CFG-4 (#82): a read grant on the data directory is refused; scripts own its format', () => {
  const [violation] = checkConventions(fixture('bad-data-read'));
  assert.equal(violation.rule, 'data-arg');
  assert.match(violation.message, /defaults\.mjs/);
});

test('violations carry file and line', () => {
  const [violation] = checkConventions(fixture('bad-env'));
  assert.equal(violation.file, 'scripts/x.mjs');
  assert.equal(violation.line, 1);
});

test('this repo follows the conventions', () => {
  assert.deepEqual(checkConventions(fileURLToPath(new URL('..', import.meta.url))), []);
});
