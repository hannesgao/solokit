// Appends one entry to <data dir>/probe.json. Usage: node probe.mjs write <n> [dataDir]
// The data dir comes from the argument (skill text substitution) or the
// CLAUDE_PLUGIN_DATA environment variable; both are recorded.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [cmd, n, argDir] = process.argv.slice(2);
if (cmd !== 'write' || !n) {
  console.error('usage: node probe.mjs write <n> [dataDir]');
  process.exit(2);
}
const envDir = process.env.CLAUDE_PLUGIN_DATA;
const dir = argDir || envDir;
if (!dir) {
  console.error('no data dir: pass it as the third argument or set CLAUDE_PLUGIN_DATA');
  process.exit(3);
}
mkdirSync(dir, { recursive: true });
const file = join(dir, 'probe.json');
let entries = [];
try {
  entries = JSON.parse(readFileSync(file, 'utf8'));
} catch {}
entries.push({
  n: Number(n),
  at: new Date().toISOString(),
  argDir: argDir ?? null,
  envDir: envDir ?? null,
  envPluginRoot: process.env.CLAUDE_PLUGIN_ROOT ?? null,
  cwd: process.cwd(),
});
writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
console.log(`probe ${n} written to ${file}`);
