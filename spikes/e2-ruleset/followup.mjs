// Spike E2 follow-up on repo A, after run.mjs: the final CodeQL default-setup
// state, and whether the API accepts the undocumented pull_request parameter
// `require_extra_approval_for_unattributed_changes` that GitHub adds on create.
// Usage (from the repo root): node spikes/e2-ruleset/followup.mjs [--owner <owner>]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const owner = process.argv.includes('--owner') ? process.argv[process.argv.indexOf('--owner') + 1] : 'hannesgao';
const REPO = `${owner}/solokit-e2-a`;
const RULESET = JSON.parse(readFileSync('spikes/e2-ruleset/solo-main.json', 'utf8'));
const api = (method, path, body) => {
  const r = spawnSync('gh', ['api', '-X', method, path, ...(body ? ['--input', '-'] : [])], { input: body && JSON.stringify(body), encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { call: `${method} ${path}`, exitCode: r.status, body: json ?? r.stdout.trim(), stderr: r.stderr.trim() || undefined };
};
const pr = rs => rs.rules.find(r => r.type === 'pull_request').parameters;
const id = api('GET', `/repos/${REPO}/rulesets`).body.find(r => r.name === RULESET.name).id;

const withFalse = structuredClone(RULESET);
pr(withFalse).require_extra_approval_for_unattributed_changes = false;
const putFalse = api('PUT', `/repos/${REPO}/rulesets/${id}`, withFalse);
const afterFalse = pr(api('GET', `/repos/${REPO}/rulesets/${id}`).body);
const putOriginal = api('PUT', `/repos/${REPO}/rulesets/${id}`, RULESET);
const afterOriginal = pr(api('GET', `/repos/${REPO}/rulesets/${id}`).body);

const out = {
  codeqlDefaultSetup: api('GET', `/repos/${REPO}/code-scanning/default-setup`).body,
  extraApprovalParam: {
    putWithFalse: { exitCode: putFalse.exitCode, stderr: putFalse.stderr },
    readBackAfterFalse: afterFalse,
    putOriginalWithoutParam: { exitCode: putOriginal.exitCode, stderr: putOriginal.stderr },
    readBackAfterOriginal: afterOriginal,
  },
};
writeFileSync('spikes/e2-ruleset/results/a/followup.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
