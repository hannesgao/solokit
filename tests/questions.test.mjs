import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { buildRound, QuestionError } from '../scripts/lib/questions.mjs';

const owner = {
  id: 'owner',
  kind: 'preference',
  question: 'Which GitHub owner should the repo belong to?',
  header: 'Owner',
  flag: '--owner',
  configKey: 'default_owner',
  options: [
    { value: 'me', description: 'Your user account' },
    { value: 'acme', description: 'The acme organisation' },
  ],
};
const CLI = fileURLToPath(new URL('../scripts/questions.mjs', import.meta.url));
const first = round => round.questions[0].options[0];
const values = round => round.questions[0].options.map(o => o.value);

test('a flag answers the question without asking', () => {
  const round = buildRound([owner], { flags: { '--owner': 'acme' } });
  assert.deepEqual(round.questions, []);
  assert.deepEqual(round.answered, { owner: { value: 'acme', source: 'flag' } });
});

test('preference precedence: evidence, then userConfig, then last used, then the default', () => {
  const evidence = { ...owner, evidence: 'acme' };
  assert.equal(first(buildRound([evidence], { config: { default_owner: 'me' }, remembered: { owner: 'me' } })).label, 'acme (detected)');
  assert.equal(first(buildRound([owner], { config: { default_owner: 'acme' }, remembered: { owner: 'me' } })).label, 'acme (from /config)');
  assert.equal(first(buildRound([owner], { config: { default_owner: '' }, remembered: { owner: 'acme' } })).label, 'acme (last used)');
  assert.equal(first(buildRound([{ ...owner, default: 'me' }], {})).label, 'me (default)');
});

test('the first option keeps the others in their given order', () => {
  assert.deepEqual(values(buildRound([owner], { remembered: { owner: 'acme' } })), ['acme', 'me']);
});

test('a remembered value that is not among the options is added first', () => {
  const round = buildRound([owner], { remembered: { owner: 'zeta' } });
  assert.deepEqual(values(round), ['zeta', 'me', 'acme']);
  assert.equal(first(round).label, 'zeta (last used)');
});

test('stack uses the last answer only when none is detected', () => {
  const stack = { id: 'stack', kind: 'preference', question: 'Stack for CI?', header: 'Stack', flag: '--stack', options: ['node', 'python', 'php', 'flutter', 'generic'].map(value => ({ value })) };
  assert.equal(first(buildRound([{ ...stack, evidence: 'python' }], { remembered: { stack: 'php' } })).value, 'python');
  assert.equal(first(buildRound([stack], { remembered: { stack: 'php' } })).value, 'php');
});

test('judgement questions ignore remembered answers and put the recommendation first', () => {
  const cls = { id: 'class', kind: 'judgement', question: 'Which class fits this idea?', header: 'Class', flag: '--class', recommended: 'feature', options: ['bug', 'tweak', 'feature', 'pivot'].map(value => ({ value })) };
  const round = buildRound([cls], { remembered: { class: 'bug' } });
  assert.equal(first(round).label, 'feature (Recommended)');
});

test('a gate never uses a remembered answer and recommends passing only when the checks passed', () => {
  const gate = { id: 'approve', kind: 'gate', question: 'Approve the PRD?', header: 'Gate 1', flag: '--approve', recommended: 'approve', options: [{ value: 'approve' }, { value: 'edit' }, { value: 'cancel' }] };
  assert.equal(first(buildRound([gate], { remembered: { approve: 'approve' }, checksPassed: true })).label, 'approve (Recommended)');
  const failed = buildRound([gate], { remembered: { approve: 'approve' }, checksPassed: false });
  assert.ok(failed.questions[0].options.every(o => !o.label.includes('(Recommended)') && !o.label.includes('(last used)')));
  assert.notEqual(first(failed).value, 'approve');
});

test('a gate is never answered from a flag that names a remembered value', () => {
  const gate = { id: 'approve', kind: 'gate', question: 'Approve?', header: 'Gate', flag: '--approve', recommended: 'approve', options: [{ value: 'approve' }, { value: 'cancel' }] };
  assert.equal(buildRound([gate], { remembered: { approve: 'approve' } }).answered.approve, undefined);
});

test('more than four options show the first plus the next three; the rest go through Other', () => {
  const many = { ...owner, options: ['a', 'b', 'c', 'd', 'e', 'f'].map(value => ({ value })) };
  const round = buildRound([many], { remembered: { owner: 'e' } });
  assert.deepEqual(values(round), ['e', 'a', 'b', 'c']);
  assert.deepEqual(round.questions[0].more, ['d', 'f']);
});

test('the AskUserQuestion shape: question, header, multiSelect, options with label and description', () => {
  const q = buildRound([owner], {}).questions[0];
  assert.deepEqual(Object.keys(q).filter(k => k !== 'id' && k !== 'more').sort(), ['header', 'multiSelect', 'options', 'question']);
  assert.equal(q.multiSelect, false);
  assert.ok(q.options.every(o => typeof o.label === 'string' && typeof o.description === 'string'));
});

test('round and option limits are enforced', () => {
  assert.throws(() => buildRound([], {}), QuestionError);
  assert.throws(() => buildRound(Array.from({ length: 5 }, (_, i) => ({ ...owner, id: `q${i}`, flag: `--q${i}` })), {}), /at most four questions/);
  assert.throws(() => buildRound([{ ...owner, options: [{ value: 'only' }] }], {}), /at least two options/);
  assert.throws(() => buildRound([{ ...owner, header: 'Much too long header' }], {}), /header/);
  assert.throws(() => buildRound([{ ...owner, flag: undefined }], {}), /needs a flag/);
  assert.throws(() => buildRound([{ ...owner, kind: 'other' }], {}), /kind/);
});

test('questions.mjs build reads remembered answers from --data and returns the round', t => {
  const dir = mkdtempSync(join(tmpdir(), 'solokit-q-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'defaults.json'), '{"owner":"acme"}\n');
  const r = spawnSync(process.execPath, [CLI, 'build', '--data', dir, '--spec', JSON.stringify([owner])], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  const { result } = JSON.parse(r.stdout);
  assert.equal(result.questions[0].options[0].label, 'acme (last used)');
  const bad = spawnSync(process.execPath, [CLI, 'build', '--data', dir, '--spec', '[]'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});

// Review follow-ups.

const gate = { id: 'approve', kind: 'gate', question: 'Approve the PRD?', header: 'Gate 1', flag: '--approve', recommended: 'approve', options: [{ value: 'approve' }, { value: 'edit' }, { value: 'cancel' }] };

test('a flag never answers a gate: the question is still asked, with the flagged option first', () => {
  const round = buildRound([gate], { flags: { '--approve': 'approve' } });
  assert.deepEqual(round.answered, {});
  assert.equal(first(round).label, 'approve (from flag)');
});

test('a flag answers a judgement question', () => {
  const cls = { id: 'class', kind: 'judgement', question: 'Class?', header: 'Class', flag: '--class', recommended: 'feature', options: [{ value: 'bug' }, { value: 'feature' }] };
  assert.deepEqual(buildRound([cls], { flags: { '--class': 'bug' } }).answered, { class: { value: 'bug', source: 'flag' } });
});

test('a recommendation must be one of the options', () => {
  assert.throws(() => buildRound([{ ...gate, recommended: 'ship it' }], { checksPassed: true }), /recommended .* one of the options/);
});

test('with failed checks the passing option stays among the four shown, last', () => {
  const big = { ...gate, options: ['approve', 'a', 'b', 'c', 'd'].map(value => ({ value })) };
  const round = buildRound([big], { checksPassed: false });
  assert.deepEqual(round.questions[0].options.map(o => o.value), ['a', 'b', 'c', 'approve']);
  assert.deepEqual(round.questions[0].more, ['d']);
});

test('a userConfig value equal to the manifest default counts as not set', () => {
  const visibility = { id: 'visibility', kind: 'preference', question: 'Visibility?', header: 'Visibility', flag: '--private', configKey: 'default_visibility', default: 'public', options: [{ value: 'public' }, { value: 'private' }] };
  const ctx = { config: { default_visibility: 'public' }, configDefaults: { default_visibility: 'public' }, remembered: { visibility: 'private' } };
  assert.equal(first(buildRound([visibility], ctx)).label, 'private (last used)');
  assert.equal(first(buildRound([visibility], { ...ctx, config: { default_visibility: 'private' }, remembered: {} })).label, 'private (from /config)');
});

test('lookups ignore inherited keys and non-string values', () => {
  const weird = { ...owner, id: 'constructor', flag: 'toString' };
  const round = buildRound([weird], { flags: {}, remembered: { constructor: { x: 1 } } });
  assert.equal(round.questions.length, 1);
  assert.ok(round.questions[0].options.every(o => !o.label.includes('object')));
});

test('ids, question texts and option labels must be unique; specs must be objects', () => {
  assert.throws(() => buildRound([owner, { ...owner, flag: '--other' }], {}), /duplicate question id "owner"/);
  assert.throws(() => buildRound([owner, { ...owner, id: 'o2', flag: '--o2' }], {}), /duplicate question text/);
  assert.throws(() => buildRound([{ ...owner, options: [{ value: 'a' }, { value: 'a' }] }], {}), /duplicate option/);
  assert.throws(() => buildRound([null], {}), QuestionError);
  assert.throws(() => buildRound([{ ...owner, id: '' }], {}), /needs an id/);
});

test('the round also comes ready for AskUserQuestion, with internal fields stripped', () => {
  const { ask } = buildRound([owner], {});
  assert.deepEqual(Object.keys(ask.questions[0]).sort(), ['header', 'multiSelect', 'options', 'question']);
  assert.deepEqual(Object.keys(ask.questions[0].options[0]).sort(), ['description', 'label']);
});

test('the questions.mjs CLI: bad JSON and a missing spec exit 2, --checks-passed reaches gates, a corrupt defaults.json is a warning', t => {
  const dir = mkdtempSync(join(tmpdir(), 'solokit-q-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [CLI, 'build', '--data', dir, ...args], { encoding: 'utf8' });
  for (const args of [['--spec', '{nope'], ['--spec', '[]', '--flags', '{nope'], ['--spec', JSON.stringify([owner]), '--config', 'x'], [], ['--spec', '[null]']]) {
    assert.equal(run(...args).status, 2, JSON.stringify(args));
  }
  const passed = JSON.parse(run('--spec', JSON.stringify([gate]), '--checks-passed').stdout).result;
  assert.equal(passed.questions[0].options[0].label, 'approve (Recommended)');
  writeFileSync(join(dir, 'defaults.json'), '{ broken');
  const warned = JSON.parse(run('--spec', JSON.stringify([owner])).stdout);
  assert.equal(warned.ok, true);
  assert.match(warned.result.warnings[0], /defaults\.json/);
});
