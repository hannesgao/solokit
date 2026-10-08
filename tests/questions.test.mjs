import assert from 'node:assert/strict';
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
  assert.equal(first(buildRound([{ ...owner, default: 'me' }], {})).label, 'me (Recommended)');
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

test('questions.mjs build reads remembered answers from --data and returns the round', async t => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'solokit-q-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'defaults.json'), '{"owner":"acme"}\n');
  const cli = new URL('../scripts/questions.mjs', import.meta.url);
  const r = spawnSync(process.execPath, [cli.pathname, 'build', '--data', dir, '--spec', JSON.stringify([owner])], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  const { result } = JSON.parse(r.stdout);
  assert.equal(result.questions[0].options[0].label, 'acme (last used)');
  const bad = spawnSync(process.execPath, [cli.pathname, 'build', '--data', dir, '--spec', '[]'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});
