// Checks a plugin tree against the script conventions of CFG-3 and CFG-4.
// Returns violations as { rule, file, line, message }; an empty list passes.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SCRIPT_CALL = 'node ${CLAUDE_PLUGIN_ROOT}/scripts/';
const ALLOWED = 'Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)';

function files(root, dir, test) {
  const base = join(root, dir);
  if (!existsSync(base)) return [];
  const out = [];
  const walk = d => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (test(name)) out.push(path);
    }
  };
  walk(base);
  return out.sort();
}

const isCode = name => /\.(mjs|cjs|js|ts|tsx)$/.test(name);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// The frontmatter's allowed-tools value, as one string.
function allowedTools(text) {
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  const m = /^allowed-tools:(.*(?:\n[ \t]+-.*)*)/m.exec(front);
  return m ? m[1] : '';
}

export function checkConventions(root) {
  const violations = [];
  const add = (rule, path, text, index, message) =>
    violations.push({ rule, file: relative(root, path).split(sep).join('/'), line: lineOf(text, index), message });

  // Skills and agents: how they call scripts and pass plugin data (CFG-4).
  const prose = [...files(root, 'skills', n => n === 'SKILL.md'), ...files(root, 'agents', n => n.endsWith('.md'))];
  for (const path of prose) {
    const text = readFileSync(path, 'utf8');
    let callsScript = false;
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/[\w./-]+/g)) {
      callsScript = true;
      if (text.slice(m.index - 'node '.length, m.index) !== 'node ') {
        add('script-call', path, text, m.index, `call kit scripts as \`${SCRIPT_CALL}<name>.mjs\``);
      }
    }
    if (callsScript && !allowedTools(text).includes(ALLOWED)) {
      add('allowed-tools', path, text, 0, `pre-approve kit scripts with allowed-tools: ${ALLOWED}`);
    }
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_DATA\}/g)) {
      if (text.slice(m.index - '--data '.length, m.index) !== '--data ') {
        add('data-arg', path, text, m.index, 'pass ${CLAUDE_PLUGIN_DATA} only as `--data` to a kit script; never write plugin data with Write or Edit');
      }
    }
  }

  // Scripts take the data directory from --data, never from the environment (CFG-4).
  for (const path of files(root, 'scripts', isCode)) {
    const text = readFileSync(path, 'utf8');
    for (const m of text.matchAll(/process\.env(?:\.CLAUDE_PLUGIN_DATA\b|\[\s*['"`]CLAUDE_PLUGIN_DATA['"`]\s*\])/g)) {
      add('data-env', path, text, m.index, 'scripts take the plugin data directory from --data, not from the environment');
    }
  }

  // No token handling anywhere in scripts or hooks: GitHub access goes through gh (CFG-3).
  for (const path of [...files(root, 'scripts', isCode), ...files(root, 'hooks', isCode)]) {
    const text = readFileSync(path, 'utf8');
    for (const m of text.matchAll(/\bGH_TOKEN\b|\bGITHUB_TOKEN\b|\bGH_ENTERPRISE_TOKEN\b|['"`]auth['"`]\s*,\s*['"`]token['"`]|\bgh auth token\b/g)) {
      add('token', path, text, m.index, 'never read or store GitHub tokens; call gh and let it use the login');
    }
  }

  return violations;
}
