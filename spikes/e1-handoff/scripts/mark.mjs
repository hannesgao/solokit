// Writes a marker file proving that a skill expanded. Usage: node mark.mjs <name>
import { mkdirSync, writeFileSync } from 'node:fs';

const name = process.argv[2] ?? 'unknown';
const at = new Date().toISOString();
mkdirSync('.spike', { recursive: true });
const file = `.spike/e1-${name}-${Date.now()}.txt`;
writeFileSync(file, `${JSON.stringify({ skill: name, at, cwd: process.cwd(), ppid: process.ppid })}\n`);
console.log(`marker written: ${file}`);
