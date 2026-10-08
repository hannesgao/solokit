#!/usr/bin/env node
// Spike E2 runner: applies the solo ruleset to a fresh public sandbox repo and
// records what GitHub does. Node built-ins only; GitHub through `gh`, git
// through `git`, both as child processes. Every step checks the real state
// first, so the runner can be re-run; M3's bootstrap scripts grow from it.
//
// Usage (from the repo root):
//   node spikes/e2-ruleset/run.mjs <scenario> [--owner <owner>] [--only step1,step2]
//
// Scenarios:
//   a  BST-7 order: initial push with ci.yml, wait for green ci, ruleset,
//      merge options, security, then PR experiments and protection checks
//   b  ruleset before ci ever ran: ruleset on the empty repo, initial push
//      without a workflow, first PR without and then with ci.yml
//
// Results: spikes/e2-ruleset/results/<scenario>/<nn>-<step>.json and summary.json.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, 'templates');
const RULESET = JSON.parse(readFileSync(join(HERE, 'solo-main.json'), 'utf8'));

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const scenario = argv[0];
const flag = name => {
  const i = argv.indexOf(`--${name}`);
  return i > 0 ? argv[i + 1] : undefined;
};
if (!['a', 'b'].includes(scenario)) {
  console.error('usage: node spikes/e2-ruleset/run.mjs <a|b> [--owner <owner>] [--only step1,step2]');
  process.exit(2);
}
const OWNER = flag('owner') ?? 'hannesgao';
const REPO = `${OWNER}/solokit-e2-${scenario}`;
const ONLY = flag('only')?.split(',');
const RESULTS = join(HERE, 'results', scenario);
const WORK = join(HERE, '.work', scenario);
mkdirSync(RESULTS, { recursive: true });

// ---------------------------------------------------------------- recording

let calls = [];

function exec(cmd, args, { input, cwd, quiet } = {}) {
  const r = spawnSync(cmd, args, { input, cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const rec = { cmd: [cmd, ...args].join(' '), cwd, exitCode: r.status, stdout: r.stdout?.trim(), stderr: r.stderr?.trim() };
  if (!quiet) calls.push(rec);
  return rec;
}

// `gh api` with the HTTP status and parsed body.
function api(method, path, body, opts = {}) {
  const args = ['api', '-i', '-X', method, path, '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  if (body !== undefined) args.push('--input', '-');
  const r = spawnSync('gh', args, { input: body === undefined ? undefined : JSON.stringify(body), encoding: 'utf8' });
  const raw = (r.stdout ?? '').replace(/\r\n/g, '\n');
  const cut = raw.indexOf('\n\n');
  const head = cut >= 0 ? raw.slice(0, cut) : raw;
  const text = cut >= 0 ? raw.slice(cut + 2).trim() : '';
  const status = Number(/^HTTP\/[\d.]+ (\d+)/.exec(head)?.[1] ?? 0);
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  const rec = { api: `${method} ${path}`, sent: body, status, body: json ?? (text || null), stderr: r.stderr?.trim() || undefined };
  if (!opts.quiet) calls.push(rec);
  return rec;
}

const ghJson = (args, opts) => {
  const r = exec('gh', args, opts);
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
};

const steps = [];
async function step(name, fn) {
  const n = String(steps.length + 1).padStart(2, '0');
  if (ONLY && !ONLY.includes(name)) {
    steps.push({ name, skipped: 'not selected' });
    return undefined;
  }
  calls = [];
  const startedAt = new Date().toISOString();
  console.log(`[${scenario}] ${n} ${name} …`);
  let outcome;
  try {
    outcome = await fn();
  } catch (error) {
    outcome = { error: String(error?.stack ?? error) };
  }
  const record = { step: name, repo: REPO, startedAt, endedAt: new Date().toISOString(), outcome, calls };
  writeFileSync(join(RESULTS, `${n}-${name}.json`), `${JSON.stringify(record, null, 2)}\n`);
  steps.push({ name, outcome });
  console.log(`[${scenario}] ${n} ${name}: ${JSON.stringify(outcome).slice(0, 400)}`);
  return outcome;
}

// ---------------------------------------------------------------- git helpers

const me = JSON.parse(exec('gh', ['api', 'user'], { quiet: true }).stdout);
const AUTHOR = ['-c', `user.name=${me.name ?? me.login}`, '-c', `user.email=${me.id}+${me.login}@users.noreply.github.com`];
const git = (...args) => exec('git', [...AUTHOR, ...args], { cwd: WORK });

function remoteHasMain() {
  return exec('git', ['ls-remote', '--heads', `https://github.com/${REPO}.git`, 'main']).stdout.includes('refs/heads/main');
}

function ensureClone() {
  if (!existsSync(join(WORK, '.git'))) {
    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(WORK, { recursive: true });
    git('init', '-q', '-b', 'main');
    git('remote', 'add', 'origin', `https://github.com/${REPO}.git`);
  }
  git('fetch', '-q', 'origin');
}

function writeFile(rel, text) {
  mkdirSync(dirname(join(WORK, rel)), { recursive: true });
  writeFileSync(join(WORK, rel), text);
}

const template = name => readFileSync(join(TEMPLATES, name), 'utf8');

// A branch from origin/main with the given files, pushed (feature branches only).
function pushBranch(branch, files, message) {
  ensureClone();
  git('checkout', '-q', '-B', branch, 'origin/main');
  for (const [rel, text] of Object.entries(files)) writeFile(rel, text);
  git('add', '-A');
  git('commit', '-q', '-m', message);
  return git('push', '-q', '-f', '-u', 'origin', branch);
}

// ---------------------------------------------------------------- GitHub helpers

function openPr(branch, title, body) {
  const existing = ghJson(['pr', 'list', '-R', REPO, '--head', branch, '--state', 'open', '--json', 'number']);
  if (existing?.length) return existing[0].number;
  const r = exec('gh', ['pr', 'create', '-R', REPO, '--head', branch, '--base', 'main', '--title', title, '--body', body]);
  return Number(/\/pull\/(\d+)/.exec(r.stdout)?.[1]);
}

const prView = n =>
  ghJson(['pr', 'view', String(n), '-R', REPO, '--json', 'number,state,mergeStateStatus,mergeable,headRefOid,statusCheckRollup,autoMergeRequest']);

// Polls until `ci` completed on the PR head, the PR merged, or the timeout.
async function waitPr(n, { timeoutMs = 300_000, until = 'ci' } = {}) {
  const started = Date.now();
  let view;
  while (Date.now() - started < timeoutMs) {
    view = prView(n);
    const ci = view?.statusCheckRollup?.find(c => c.name === 'ci');
    if (until === 'ci' && ci?.status === 'COMPLETED') break;
    if (until === 'merged' && view?.state === 'MERGED') break;
    await sleep(10_000);
  }
  calls.push({ waited: `${until} on PR #${n}`, ms: Date.now() - started, view });
  return view;
}

async function waitMainRun(sha, timeoutMs = 300_000) {
  const started = Date.now();
  let run;
  while (Date.now() - started < timeoutMs) {
    const runs = ghJson(['run', 'list', '-R', REPO, '--branch', 'main', '--json', 'databaseId,status,conclusion,headSha,event,name', '-L', '10'], { quiet: true });
    run = runs?.find(r => r.headSha === sha);
    if (run?.status === 'completed') break;
    await sleep(10_000);
  }
  calls.push({ waited: `run for ${sha} on main`, ms: Date.now() - started, run });
  return run;
}

function merge(n, extra = []) {
  const r = exec('gh', ['pr', 'merge', String(n), '-R', REPO, '--squash', ...extra]);
  return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
}

function jobSteps(runId) {
  const view = ghJson(['run', 'view', String(runId), '-R', REPO, '--json', 'jobs']);
  return view?.jobs?.map(j => ({ name: j.name, conclusion: j.conclusion, steps: j.steps.map(s => `${s.name}: ${s.conclusion}`) }));
}

const rulesetId = () => api('GET', `/repos/${REPO}/rulesets`, undefined, { quiet: true }).body?.find?.(r => r.name === RULESET.name)?.id;

// ---------------------------------------------------------------- read-back

// The subset of a ruleset that states intent: what solokit sends, with rules
// keyed by type and keys sorted, so the same intent always hashes the same.
export function normalizeRuleset(r) {
  const sortKeys = v =>
    Array.isArray(v)
      ? v.map(sortKeys)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]))
        : v;
  const rules = [...(r.rules ?? [])]
    .map(rule => {
      const p = rule.parameters ? { ...rule.parameters } : undefined;
      if (p?.required_status_checks) p.required_status_checks = [...p.required_status_checks].sort((x, y) => x.context.localeCompare(y.context));
      if (p?.allowed_merge_methods) p.allowed_merge_methods = [...p.allowed_merge_methods].sort();
      return p ? { type: rule.type, parameters: p } : { type: rule.type };
    })
    .sort((x, y) => x.type.localeCompare(y.type));
  return sortKeys({
    name: r.name,
    target: r.target,
    enforcement: r.enforcement,
    conditions: r.conditions,
    bypass_actors: r.bypass_actors ?? [],
    rules,
  });
}

export const rulesetHash = r => createHash('sha256').update(JSON.stringify(normalizeRuleset(r))).digest('hex');

// What GitHub applied, cut down to the keys the intent names: top-level fields
// and, per rule type, the parameter keys the intent sends. Keys GitHub adds
// with defaults (ids, links, timestamps, new rule parameters) fall away, so
// read-back and intent hash the same exactly when every sent value holds.
export function intentView(got, intent) {
  const rules = intent.rules.map(want => {
    const have = got.rules?.find(r => r.type === want.type);
    if (!have) return { type: `${want.type} (missing)` };
    if (!want.parameters) return { type: want.type };
    const parameters = Object.fromEntries(Object.keys(want.parameters).map(k => [k, have.parameters?.[k]]));
    return { type: want.type, parameters };
  });
  return { name: got.name, target: got.target, enforcement: got.enforcement, conditions: got.conditions, bypass_actors: got.bypass_actors ?? [], rules };
}

// Paths that differ between two JSON values: added, removed, changed.
function diff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = v => v && typeof v === 'object';
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap(k => {
      const p = `${path}${Array.isArray(a) ? `[${k}]` : `.${k}`}`;
      if (!(k in a)) return [{ path: p, change: 'added by GitHub', value: b[k] }];
      if (!(k in b)) return [{ path: p, change: 'dropped by GitHub', value: a[k] }];
      return diff(a[k], b[k], p);
    });
  }
  return [{ path: path || '.', change: 'changed', sent: a, got: b }];
}

function readback() {
  const id = rulesetId();
  if (!id) return { error: 'no ruleset named solo-main' };
  const got = api('GET', `/repos/${REPO}/rulesets/${id}`).body;
  api('GET', `/repos/${REPO}/rules/branches/main`);
  const sentByType = normalizeRuleset(RULESET);
  const gotByType = normalizeRuleset(got);
  const view = intentView(got, RULESET);
  return {
    rawDiff: diff(RULESET, got),
    normalizedDiff: diff(sentByType, gotByType),
    intentDiff: diff(normalizeRuleset(RULESET), normalizeRuleset(view)),
    hashSent: rulesetHash(RULESET),
    hashGotFull: rulesetHash(got),
    hashGotIntentView: rulesetHash(view),
    intentHashesMatch: rulesetHash(RULESET) === rulesetHash(view),
  };
}

// ---------------------------------------------------------------- shared steps

function createRepo() {
  const view = exec('gh', ['repo', 'view', REPO, '--json', 'name,visibility,isEmpty']);
  if (view.exitCode === 0) return { existed: true, view: JSON.parse(view.stdout) };
  const r = exec('gh', ['repo', 'create', REPO, '--public', '--description', `solokit spike E2 sandbox (${scenario}); safe to delete`]);
  return { created: r.exitCode === 0, stdout: r.stdout, stderr: r.stderr };
}

function initialPush(withCi) {
  if (remoteHasMain()) return { skipped: 'main exists' };
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', `https://github.com/${REPO}.git`);
  writeFile('README.md', `# ${REPO}\n\nSandbox for solokit spike E2. Safe to delete.\n`);
  writeFile('docs/notes.md', '# Notes\n');
  if (withCi) writeFile('.github/workflows/ci.yml', template('ci.yml'));
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: initial commit');
  const push = git('push', '-q', '-u', 'origin', 'main');
  const sha = git('rev-parse', 'HEAD').stdout;
  const repo = api('GET', `/repos/${REPO}`).body;
  return { pushExitCode: push.exitCode, pushStderr: push.stderr, sha, defaultBranch: repo?.default_branch };
}

function applyRuleset() {
  const id = rulesetId();
  const r = id ? api('PUT', `/repos/${REPO}/rulesets/${id}`, RULESET) : api('POST', `/repos/${REPO}/rulesets`, RULESET);
  return { method: id ? 'PUT' : 'POST', status: r.status, id: r.body?.id, message: r.body?.message, errors: r.body?.errors };
}

function mergeOptions() {
  const want = {
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    allow_auto_merge: true,
    delete_branch_on_merge: true,
    squash_merge_commit_title: 'PR_TITLE',
    squash_merge_commit_message: 'PR_BODY',
    has_wiki: false,
    has_projects: false,
  };
  const r = api('PATCH', `/repos/${REPO}`, want);
  const got = api('GET', `/repos/${REPO}`).body;
  const gaps = Object.entries(want).filter(([k, v]) => got?.[k] !== v).map(([k, v]) => ({ key: k, want: v, got: got?.[k] }));
  return { status: r.status, gaps };
}

async function security() {
  const before = {
    vulnerabilityAlerts: api('GET', `/repos/${REPO}/vulnerability-alerts`).status,
    automatedSecurityFixes: api('GET', `/repos/${REPO}/automated-security-fixes`).body,
    securityAndAnalysis: api('GET', `/repos/${REPO}`).body?.security_and_analysis,
    codeqlDefaultSetup: api('GET', `/repos/${REPO}/code-scanning/default-setup`).body,
  };
  const set = {
    vulnerabilityAlerts: api('PUT', `/repos/${REPO}/vulnerability-alerts`).status,
    automatedSecurityFixes: api('PUT', `/repos/${REPO}/automated-security-fixes`).status,
    secretScanning: api('PATCH', `/repos/${REPO}`, {
      security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } },
    }).status,
    codeqlDefaultSetup: (() => {
      const r = api('PATCH', `/repos/${REPO}/code-scanning/default-setup`, { state: 'configured', query_suite: 'default' });
      return { status: r.status, body: r.body };
    })(),
  };
  await sleep(15_000);
  const after = {
    vulnerabilityAlerts: api('GET', `/repos/${REPO}/vulnerability-alerts`).status,
    automatedSecurityFixes: api('GET', `/repos/${REPO}/automated-security-fixes`).body,
    securityAndAnalysis: api('GET', `/repos/${REPO}`).body?.security_and_analysis,
    codeqlDefaultSetup: api('GET', `/repos/${REPO}/code-scanning/default-setup`).body,
  };
  return { before, set, after };
}

// ---------------------------------------------------------------- scenario A

async function scenarioA() {
  await step('create-repo', createRepo);
  const init = await step('initial-push', () => initialPush(true));
  await step('wait-main-ci', async () => {
    const sha = init?.sha ?? git('rev-parse', 'origin/main').stdout;
    const run = await waitMainRun(sha);
    return { sha, run };
  });
  await step('apply-ruleset', applyRuleset);
  await step('merge-options', mergeOptions);
  await step('security', security);
  await step('readback', readback);

  await step('feature-pr', async () => {
    pushBranch('feat/1-hello', { 'src/hello.txt': 'hello\n' }, 'feat: add hello');
    const n = openPr('feat/1-hello', 'feat: add hello', 'First feature PR for spike E2.');
    const before = prView(n);
    const view = await waitPr(n);
    const result = merge(n);
    const after = prView(n);
    return { pr: n, mergeStateBeforeCi: before?.mergeStateStatus, ciDone: view?.statusCheckRollup, mergeStateAfterCi: view?.mergeStateStatus, merge: result, state: after?.state };
  });

  await step('strict-up-to-date', async () => {
    pushBranch('feat/2-alpha', { 'src/alpha.txt': 'alpha\n' }, 'feat: add alpha');
    pushBranch('feat/3-beta', { 'src/beta.txt': 'beta\n' }, 'feat: add beta');
    const a = openPr('feat/2-alpha', 'feat: add alpha', 'Strict policy check, first PR.');
    const b = openPr('feat/3-beta', 'feat: add beta', 'Strict policy check, second PR.');
    await waitPr(a);
    await waitPr(b);
    const mergeA = merge(a);
    await sleep(5_000);
    const bBehind = prView(b);
    const mergeBDirect = merge(b);
    const autoB = merge(b, ['--auto']);
    await sleep(20_000);
    const bAfterAuto = prView(b);
    const update = exec('gh', ['pr', 'update-branch', String(b), '-R', REPO]);
    const bFinal = await waitPr(b, { until: 'merged', timeoutMs: 300_000 });
    return {
      prs: [a, b],
      mergeA,
      bMergeStateAfterAMerged: bBehind?.mergeStateStatus,
      mergeBDirect,
      autoB,
      bAfterAuto: { state: bAfterAuto?.state, mergeStateStatus: bAfterAuto?.mergeStateStatus, autoMergeRequest: bAfterAuto?.autoMergeRequest },
      updateBranch: { exitCode: update.exitCode, stdout: update.stdout, stderr: update.stderr },
      bFinalState: bFinal?.state,
    };
  });

  await step('docs-only-pr', async () => {
    pushBranch('docs/4-notes', { 'docs/notes.md': '# Notes\n\nA docs-only change.\n' }, 'docs: extend notes');
    const n = openPr('docs/4-notes', 'docs: extend notes', 'Docs-only PR: the Test step is skipped with a step-level if.');
    const view = await waitPr(n);
    const ci = view?.statusCheckRollup?.find(c => c.name === 'ci');
    const runId = /\/runs\/(\d+)/.exec(ci?.detailsUrl ?? '')?.[1];
    const jobs = runId ? jobSteps(runId) : null;
    const result = merge(n);
    return { pr: n, ci: { status: ci?.status, conclusion: ci?.conclusion }, jobs, merge: result, state: prView(n)?.state };
  });

  await step('paths-filter-counter-check', async () => {
    pushBranch(
      'ci/5-paths-filter',
      { 'docs/notes.md': '# Notes\n\nCounter-check with a paths filter.\n', '.github/workflows/ci.yml': template('ci-paths.yml') },
      'ci: add paths filter (counter-check)',
    );
    const n = openPr('ci/5-paths-filter', 'ci: add paths filter (counter-check)', 'Counter-check: a paths-filtered workflow never reports `ci`. Not to be merged.');
    const view = await waitPr(n, { timeoutMs: 120_000 });
    const checks = exec('gh', ['pr', 'checks', String(n), '-R', REPO]);
    const checkRuns = api('GET', `/repos/${REPO}/commits/${view?.headRefOid}/check-runs`).body?.check_runs?.map(c => c.name);
    const result = merge(n);
    exec('gh', ['pr', 'close', String(n), '-R', REPO, '--delete-branch']);
    return { pr: n, rollup: view?.statusCheckRollup, mergeStateStatus: view?.mergeStateStatus, prChecks: { exitCode: checks.exitCode, stdout: checks.stdout, stderr: checks.stderr }, checkRuns, merge: result };
  });

  await step('protection', () => {
    ensureClone();
    git('checkout', '-q', '-B', 'main', 'origin/main');
    writeFile('direct.txt', 'direct push\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'chore: direct push to main');
    const direct = git('push', 'origin', 'HEAD:main');
    git('reset', '-q', '--hard', 'origin/main');
    const force = git('push', '--force', 'origin', 'HEAD~1:main');
    const del = git('push', 'origin', ':main');
    return {
      directPush: { exitCode: direct.exitCode, stderr: direct.stderr },
      forcePush: { exitCode: force.exitCode, stderr: force.stderr },
      deleteMain: { exitCode: del.exitCode, stderr: del.stderr },
    };
  });
}

// ---------------------------------------------------------------- scenario B

async function scenarioB() {
  await step('create-repo', createRepo);
  await step('apply-ruleset-on-empty-repo', applyRuleset);
  await step('initial-push-without-workflow', () => {
    const r = initialPush(false);
    let fallback;
    if (r.pushExitCode && r.pushExitCode !== 0) {
      // The ruleset blocked the very first push: record it, then push with the
      // ruleset disabled for a moment so the rest of the scenario can run.
      const id = rulesetId();
      api('PUT', `/repos/${REPO}/rulesets/${id}`, { ...RULESET, enforcement: 'disabled' });
      const push = git('push', '-q', '-u', 'origin', 'main');
      api('PUT', `/repos/${REPO}/rulesets/${id}`, RULESET);
      fallback = { pushedWithRulesetDisabled: push.exitCode === 0 };
    }
    return { ...r, fallback, rulesInForce: api('GET', `/repos/${REPO}/rules/branches/main`).body?.map?.(x => x.type) };
  });
  await step('readback', readback);

  await step('first-pr-without-workflow', async () => {
    pushBranch('feat/1-hello', { 'src/hello.txt': 'hello\n' }, 'feat: add hello');
    const n = openPr('feat/1-hello', 'feat: add hello', 'First PR while ci has never run anywhere.');
    await sleep(60_000);
    const view = prView(n);
    const checks = exec('gh', ['pr', 'checks', String(n), '-R', REPO]);
    const result = merge(n);
    return { pr: n, mergeStateStatus: view?.mergeStateStatus, rollup: view?.statusCheckRollup, prChecks: { exitCode: checks.exitCode, stdout: checks.stdout, stderr: checks.stderr }, merge: result };
  });

  await step('same-pr-with-workflow', async () => {
    ensureClone();
    git('checkout', '-q', '-B', 'feat/1-hello', 'origin/feat/1-hello');
    writeFile('.github/workflows/ci.yml', template('ci.yml'));
    git('add', '-A');
    git('commit', '-q', '-m', 'ci: add workflow');
    git('push', '-q', 'origin', 'feat/1-hello');
    const n = openPr('feat/1-hello', 'feat: add hello', '');
    const view = await waitPr(n);
    const result = merge(n);
    const after = prView(n);
    const mainRun = await waitMainRun(git('ls-remote', 'origin', 'refs/heads/main').stdout.split(/\s/)[0]);
    return { pr: n, ci: view?.statusCheckRollup, mergeStateStatus: view?.mergeStateStatus, merge: result, state: after?.state, firstPushRunOnMain: mainRun };
  });
}

// ---------------------------------------------------------------- main

await (scenario === 'a' ? scenarioA() : scenarioB());
// The summary is rebuilt from every step file, so a partial re-run (--only)
// keeps the other steps' last results.
const recorded = readdirSync(RESULTS)
  .filter(f => /^\d\d-.+\.json$/.test(f))
  .sort()
  .map(f => JSON.parse(readFileSync(join(RESULTS, f), 'utf8')))
  .map(r => ({ step: r.step, startedAt: r.startedAt, outcome: r.outcome }));
writeFileSync(join(RESULTS, 'summary.json'), `${JSON.stringify({ repo: REPO, steps: recorded }, null, 2)}\n`);
console.log(`[${scenario}] done; results in ${RESULTS}`);
