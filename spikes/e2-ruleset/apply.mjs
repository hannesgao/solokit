#!/usr/bin/env node
// Applies the solokit GitHub defaults to an existing repo in the order ADR 0003
// requires, then reads everything back. Grown from the E2 runner; M3's
// bootstrap-remote script starts from here. Node built-ins only; GitHub
// through `gh`. Every step reads first and writes only what differs.
//
// Usage (from the repo root):
//   node spikes/e2-ruleset/apply.mjs --repo <owner/name> [--ruleset .github/rulesets/main.json]
//     [--delete-labels name,name] [--dry-run]
//
// --delete-labels removes the named labels when no issue or PR carries them.
// --dry-run reads the repo and prints every write it would make, making none.
// The report is printed and saved to spikes/e2-ruleset/results/apply/.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diff, ghApi, intentView, normalizeRuleset, rulesetHash } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = name => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const REPO = flag('repo');
const DRY = argv.includes('--dry-run');
const RULESET_FILE = flag('ruleset') ?? '.github/rulesets/main.json';
const DELETE_LABELS = flag('delete-labels')?.split(',').filter(Boolean) ?? [];
if (!REPO || !/^[\w.-]+\/[\w.-]+$/.test(REPO)) {
  console.error('usage: node spikes/e2-ruleset/apply.mjs --repo <owner/name> [--ruleset <file>] [--dry-run]');
  process.exit(2);
}
const RULESET = JSON.parse(readFileSync(RULESET_FILE, 'utf8'));

// Conventions v0.2: repository settings and labels.
const MERGE_OPTIONS = {
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
const LABELS = [
  ['type:feature', 'a2eeef', 'New or changed behaviour from the PRD'],
  ['type:bug', 'd73a4a', 'The product does not do what the PRD says'],
  ['type:chore', 'c5def5', 'Maintenance, tooling, experiments'],
  ['type:docs', '0075ca', 'Documentation only'],
  ['priority:p0', 'b60205', 'Main path to the milestone done criterion'],
  ['priority:p1', 'd93f0b', 'Guards and robustness'],
  ['priority:p2', 'fbca04', 'Conveniences'],
  ['status:blocked', '5319e7', 'Cannot proceed; see the issue for why'],
  ['status:needs-decision', 'd876e3', 'Waiting for a decision by the owner'],
  ['review:waived', 'e99695', 'Merged with a waived blocking review finding (never security)'],
  ['change', '1d76db', 'Born from a change request'],
].map(([name, color, description]) => ({ name, color, description }));

const report = { repo: REPO, dryRun: DRY, at: new Date().toISOString(), steps: {} };
const writes = [];

// A write, or in a dry run the record of one.
function write(method, path, body) {
  if (DRY) {
    writes.push({ api: `${method} ${path}`, body });
    return { status: 'dry-run' };
  }
  const r = ghApi(method, path, body);
  writes.push({ api: r.api, body, status: r.status, error: r.status >= 300 ? r.body : undefined });
  return r;
}

function fail(step, reason) {
  report.steps[step] = { error: reason };
  finish(1);
}

function finish(code) {
  report.writes = writes;
  const dir = join(HERE, 'results', 'apply');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${REPO.replace('/', '__')}-${report.at.replace(/[:.]/g, '-')}${DRY ? '-dry-run' : ''}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.error(`report: ${file}`);
  process.exit(code);
}

// ---------------------------------------------------------------- 1. preflight

const repo = ghApi('GET', `/repos/${REPO}`);
if (repo.status !== 200) fail('preflight', `cannot read ${REPO}: ${repo.status}`);
if (!repo.body.permissions?.admin) fail('preflight', `no admin rights on ${REPO}`);
const branch = repo.body.default_branch;
const head = ghApi('GET', `/repos/${REPO}/branches/${branch}`).body?.commit?.sha;
const runs = ghApi('GET', `/repos/${REPO}/actions/runs?branch=${branch}&event=push&head_sha=${head}&per_page=20`).body?.workflow_runs ?? [];
const ciRun = runs.find(r => r.path === '.github/workflows/ci.yml');
report.steps.preflight = { defaultBranch: branch, head, ciRun: ciRun && { id: ciRun.id, status: ciRun.status, conclusion: ciRun.conclusion } };
const existingRulesets = ghApi('GET', `/repos/${REPO}/rulesets`).body ?? [];
const existing = existingRulesets.find(r => r.name === RULESET.name);
// ADR 0003: the required check may only be added once `ci` passed on the
// default branch's head; an already applied ruleset is just compared.
if (!existing && ciRun?.conclusion !== 'success') {
  const reason = `ci has not passed on ${branch}@${head?.slice(0, 7)}; push ci.yml and wait for a green run first`;
  if (!DRY) fail('preflight', reason);
  report.steps.preflight.blocker = `${reason} (a real run stops here)`;
}

// ---------------------------------------------------------------- 2. ruleset

{
  const intentHash = rulesetHash(RULESET);
  if (existing) {
    const got = ghApi('GET', `/repos/${REPO}/rulesets/${existing.id}`).body;
    const same = rulesetHash(intentView(got, RULESET)) === intentHash;
    if (!same) write('PUT', `/repos/${REPO}/rulesets/${existing.id}`, RULESET);
    report.steps.ruleset = { action: same ? 'unchanged' : 'update', id: existing.id };
  } else {
    const r = write('POST', `/repos/${REPO}/rulesets`, RULESET);
    report.steps.ruleset = { action: 'create', status: r.status };
  }
}

// ---------------------------------------------------------------- 3. merge options

{
  const changes = Object.fromEntries(Object.entries(MERGE_OPTIONS).filter(([k, v]) => repo.body[k] !== v));
  if (Object.keys(changes).length) write('PATCH', `/repos/${REPO}`, changes);
  report.steps.mergeOptions = { changes: Object.entries(changes).map(([k, v]) => ({ key: k, from: repo.body[k], to: v })) };
}

// ---------------------------------------------------------------- 4. labels

{
  const have = ghApi('GET', `/repos/${REPO}/labels?per_page=100`).body ?? [];
  const actions = [];
  for (const want of LABELS) {
    const cur = have.find(l => l.name === want.name);
    if (!cur) {
      write('POST', `/repos/${REPO}/labels`, want);
      actions.push({ label: want.name, action: 'create' });
    } else if (cur.color !== want.color || (cur.description ?? '') !== want.description) {
      write('PATCH', `/repos/${REPO}/labels/${encodeURIComponent(want.name)}`, { color: want.color, description: want.description });
      actions.push({ label: want.name, action: 'update' });
    }
  }
  for (const name of DELETE_LABELS) {
    if (!have.some(l => l.name === name)) continue;
    const q = encodeURIComponent(`repo:${REPO} label:"${name}"`);
    const used = ghApi('GET', `/search/issues?q=${q}&per_page=1`).body?.total_count;
    if (used === 0) {
      write('DELETE', `/repos/${REPO}/labels/${encodeURIComponent(name)}`);
      actions.push({ label: name, action: 'delete' });
    } else {
      actions.push({ label: name, action: 'kept', reason: `used by ${used ?? 'an unknown number of'} issues or PRs` });
    }
  }
  const others = have.map(l => l.name).filter(n => !LABELS.some(w => w.name === n) && !DELETE_LABELS.includes(n) && !n.startsWith('cr:'));
  report.steps.labels = { actions, otherLabels: others };
}

// ---------------------------------------------------------------- 5. security

function securityState() {
  return {
    dependabotAlerts: ghApi('GET', `/repos/${REPO}/vulnerability-alerts`).status === 204,
    dependabotSecurityUpdates: ghApi('GET', `/repos/${REPO}/automated-security-fixes`).body?.enabled === true,
    secretScanning: ghApi('GET', `/repos/${REPO}`).body?.security_and_analysis?.secret_scanning?.status === 'enabled',
    pushProtection: ghApi('GET', `/repos/${REPO}`).body?.security_and_analysis?.secret_scanning_push_protection?.status === 'enabled',
    codeqlDefaultSetup: ghApi('GET', `/repos/${REPO}/code-scanning/default-setup`).body?.state === 'configured',
    privateVulnerabilityReporting: ghApi('GET', `/repos/${REPO}/private-vulnerability-reporting`).body?.enabled === true,
  };
}

{
  const before = securityState();
  if (!before.dependabotAlerts) write('PUT', `/repos/${REPO}/vulnerability-alerts`);
  if (!before.dependabotSecurityUpdates) write('PUT', `/repos/${REPO}/automated-security-fixes`);
  if (!before.secretScanning || !before.pushProtection) {
    write('PATCH', `/repos/${REPO}`, {
      security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } },
    });
  }
  if (!before.codeqlDefaultSetup) write('PATCH', `/repos/${REPO}/code-scanning/default-setup`, { state: 'configured', query_suite: 'default' });
  if (!before.privateVulnerabilityReporting) write('PUT', `/repos/${REPO}/private-vulnerability-reporting`);
  report.steps.security = { before };
}

// ---------------------------------------------------------------- 6. read-back (BST-8)

if (!DRY) {
  // CodeQL default setup answers 202 and settles a few seconds later.
  if (writes.some(w => w.api.includes('/code-scanning/'))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15_000);
  const gaps = [];
  const rs = ghApi('GET', `/repos/${REPO}/rulesets`).body?.find(r => r.name === RULESET.name);
  const got = rs && ghApi('GET', `/repos/${REPO}/rulesets/${rs.id}`).body;
  const view = got ? intentView(got, RULESET) : null;
  const intentDiff = view ? diff(normalizeRuleset(RULESET), normalizeRuleset(view)) : [{ path: '.', change: 'ruleset missing' }];
  if (intentDiff.length) gaps.push({ area: 'ruleset', intentDiff });
  const added = got ? diff(RULESET, got).filter(d => d.change === 'added by GitHub') : [];

  const after = ghApi('GET', `/repos/${REPO}`).body;
  for (const [k, v] of Object.entries(MERGE_OPTIONS)) if (after?.[k] !== v) gaps.push({ area: 'merge options', key: k, want: v, got: after?.[k] });

  const labels = ghApi('GET', `/repos/${REPO}/labels?per_page=100`).body ?? [];
  for (const want of LABELS) {
    const cur = labels.find(l => l.name === want.name);
    if (!cur || cur.color !== want.color || (cur.description ?? '') !== want.description) gaps.push({ area: 'labels', label: want.name, got: cur ?? null });
  }

  const security = securityState();
  for (const [k, v] of Object.entries(security)) if (!v) gaps.push({ area: 'security', key: k, got: v });

  report.steps.readback = {
    rulesetSha: view ? `sha256:${rulesetHash(view)}` : null,
    intentSha: `sha256:${rulesetHash(RULESET)}`,
    addedByGitHub: added.map(d => ({ path: d.path, value: d.value })),
    security,
    gaps,
  };
  finish(gaps.length ? 1 : 0);
}
finish(0);
