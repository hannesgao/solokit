import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const prd = readFileSync(new URL('../docs/PRD.md', import.meta.url), 'utf8');

// The "Plugin options" table of docs/PRD.md: key, type, default.
function prdOptions() {
  const section = prd.slice(prd.indexOf('**Plugin options**'), prd.indexOf('**Remembered answers**'));
  const rows = section.split('\n').filter(line => /^\| `[a-z_]+` \|/.test(line));
  return rows.map(row => {
    const [key, type, def] = row.split('|').slice(1, 4).map(cell => cell.trim());
    return { key: key.replaceAll('`', ''), type, def };
  });
}

// What a PRD default cell means as a userConfig default.
function expectedDefault({ type, def }) {
  if (type === 'boolean') return def === '`true`';
  if (def.startsWith('empty')) return '';
  return def.replaceAll('`', '');
}

test('plugin.json names the plugin and its display name', () => {
  const manifest = read('.claude-plugin/plugin.json');
  assert.equal(manifest.name, 'solokit');
  assert.equal(manifest.displayName, 'solo-agent-coding-kit');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description);
  assert.ok(manifest.author?.name);
});

test('userConfig matches the PRD plugin options table', () => {
  const { userConfig } = read('.claude-plugin/plugin.json');
  const options = prdOptions();
  assert.ok(options.length >= 6, 'PRD table parsed');
  assert.deepEqual(Object.keys(userConfig).sort(), options.map(o => o.key).sort());
  for (const option of options) {
    const field = userConfig[option.key];
    const type = option.type === 'boolean' ? 'boolean' : 'string';
    assert.equal(field.type, type, `${option.key} type`);
    assert.ok(field.title && field.description, `${option.key} title and description`);
    assert.deepEqual(field.default, expectedDefault(option), `${option.key} default`);
    assert.notEqual(field.sensitive, true, `${option.key} is not a secret (CFG-3)`);
  }
});

test('default_visibility is limited to public and private', () => {
  const { userConfig } = read('.claude-plugin/plugin.json');
  assert.deepEqual(userConfig.default_visibility.options, ['public', 'private']);
});

test('marketplace.json lists this repo as the plugin source', () => {
  const marketplace = read('.claude-plugin/marketplace.json');
  assert.equal(marketplace.name, 'solokit');
  assert.ok(marketplace.owner?.name);
  assert.deepEqual(
    marketplace.plugins.map(p => [p.name, p.source]),
    [['solokit', './']],
  );
});
