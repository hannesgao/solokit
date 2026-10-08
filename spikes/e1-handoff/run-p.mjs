// Spike E1, question 2: plugin skills in `claude -p` runs.
// Usage (from the repo root): node spikes/e1-handoff/run-p.mjs [case ...]
// Each case's JSON result goes to spikes/e1-handoff/results/p-<case>.json,
// and a summary of all cases run to results/p-summary.md.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN = 'spikes/e1-handoff';
const RESULTS = join(PLUGIN, 'results');
const BASE = ['--plugin-dir', PLUGIN, '--output-format', 'json'];

const CASES = {
  'go-hello': ['-p', '/solokit-e1:go hello', ...BASE],
  'ask-plain': ['-p', '/solokit-e1:ask', ...BASE],
  'ask-prompts-none': ['-p', '/solokit-e1:ask', ...BASE, '--permission-prompts', 'none'],
  'ask-dontask': ['-p', '/solokit-e1:ask', ...BASE, '--permission-mode', 'dontAsk'],
  'perm-plain': ['-p', '/solokit-e1:perm', ...BASE],
};

const picked = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CASES);
mkdirSync(RESULTS, { recursive: true });
const rows = [];
for (const name of picked) {
  const argv = CASES[name];
  if (!argv) throw new Error(`unknown case ${name}`);
  const started = new Date().toISOString();
  const run = spawnSync('claude', argv, { encoding: 'utf8', timeout: 600_000 });
  let json = null;
  try {
    json = JSON.parse(run.stdout);
  } catch {}
  const record = { case: name, argv: ['claude', ...argv], started, exitCode: run.status, json, stdout: json ? undefined : run.stdout, stderr: run.stderr };
  writeFileSync(join(RESULTS, `p-${name}.json`), `${JSON.stringify(record, null, 2)}\n`);
  const denials = json?.permission_denials ?? [];
  rows.push(`| ${name} | ${run.status} | ${String(json?.result ?? '').replace(/\n/g, ' ').slice(0, 160)} | ${denials.map(d => d.tool_name).join(', ') || '—'} |`);
  console.log(`${name}: exit ${run.status}`);
}
const summary = ['| Case | Exit | Result | permission_denials |', '| --- | --- | --- | --- |', ...rows].join('\n');
writeFileSync(join(RESULTS, `p-summary-${picked.join('+')}.md`), `${summary}\n`);
console.log(summary);
