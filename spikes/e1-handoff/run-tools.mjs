// Spike E1, question 2 (evidence): which tools a `claude -p` session offers
// under each permission setting, read from the stream-json `system/init` event.
// Usage (from the repo root): node spikes/e1-handoff/run-tools.mjs
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const BASE = ['-p', 'Reply with the single word OK.', '--plugin-dir', 'spikes/e1-handoff',
  '--output-format', 'stream-json', '--verbose', '--model', 'haiku'];
const CASES = {
  plain: [],
  'prompts-none': ['--permission-prompts', 'none'],
  'prompts-host': ['--permission-prompts', 'host'],
  dontAsk: ['--permission-mode', 'dontAsk'],
  manual: ['--permission-mode', 'manual'],
};
const rows = ['| Case | Flags | permissionMode | AskUserQuestion in tools | tool count |', '| --- | --- | --- | --- | --- |'];
const raw = {};
for (const [name, flags] of Object.entries(CASES)) {
  const run = spawnSync('claude', [...BASE, ...flags], { encoding: 'utf8', timeout: 300_000 });
  const init = run.stdout.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
    .find(m => m?.type === 'system' && m?.subtype === 'init');
  raw[name] = { flags, exitCode: run.status, permissionMode: init?.permissionMode, tools: init?.tools, stderr: run.stderr };
  rows.push(`| ${name} | ${flags.join(' ') || '—'} | ${init?.permissionMode} | ${init?.tools?.includes('AskUserQuestion') ? 'yes' : 'no'} | ${init?.tools?.length} |`);
  console.log(name, run.status);
}
writeFileSync('spikes/e1-handoff/results/p-tools.json', `${JSON.stringify(raw, null, 2)}\n`);
writeFileSync('spikes/e1-handoff/results/p-tools.md', `${rows.join('\n')}\n`);
console.log(rows.join('\n'));
