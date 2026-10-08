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

// The frontmatter's allowed-tools value, as one string: inline, or a YAML
// list whose items may sit at column 0.
function allowedTools(text) {
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  const m = /^allowed-tools:(.*(?:\n[ \t]*-.*)*)/m.exec(front);
  return m ? m[1] : '';
}

export function checkConventions(root) {
  const violations = [];
  const add = (rule, path, text, index, message) =>
    violations.push({ rule, file: relative(root, path).split(sep).join('/'), line: lineOf(text, index), message });

  // Skills and agents: how they call scripts and pass plugin data (CFG-4).
  // Agents declare `tools`, not `allowed-tools`, so only skills need the grant.
  const prose = [
    ...files(root, 'skills', n => n === 'SKILL.md').map(path => ({ path, skill: true })),
    ...files(root, 'agents', n => n.endsWith('.md')).map(path => ({ path, skill: false })),
  ];
  for (const { path, skill } of prose) {
    const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    let callsScript = false;
    // `scripts/*` in an allowed-tools rule is the grant, not a call.
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/(?!\*)[\w./-]*/g)) {
      callsScript = true;
      const isScript = /^\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/[\w-]+\.mjs$/.test(m[0]);
      if (text.slice(m.index - 'node '.length, m.index) !== 'node ' || !isScript) {
        add('script-call', path, text, m.index, `call kit scripts as \`${SCRIPT_CALL}<name>.mjs\``);
      }
    }
    if (skill && callsScript && !allowedTools(text).includes(ALLOWED)) {
      add('allowed-tools', path, text, 0, `pre-approve kit scripts with allowed-tools: ${ALLOWED}`);
    }
    // Any spelling of the plugin data directory: the substitution, a shell
    // variable, or a resolved path. Only `--data ${CLAUDE_PLUGIN_DATA}` passes;
    // reads are refused too, since scripts own the files' format (#82).
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_DATA\b[^}]*\}|\$(?:env:)?CLAUDE_PLUGIN_DATA\b|%CLAUDE_PLUGIN_DATA%|\.claude[\/\\]plugins[\/\\]data\b/g)) {
      const exact = m[0] === '${CLAUDE_PLUGIN_DATA}';
      if (!exact || text.slice(m.index - '--data '.length, m.index) !== '--data ') {
        add('data-arg', path, text, m.index, 'name the plugin data directory only as `--data ${CLAUDE_PLUGIN_DATA}` to a kit script; read and write remembered answers through scripts/defaults.mjs, never with Read, Write or Edit');
      }
    }
  }

  // Scripts take the data directory from --data, never from the environment (CFG-4).
  for (const path of files(root, 'scripts', isCode)) {
    const text = readFileSync(path, 'utf8');
    // Any mention of the variable outside a string read by name: `process.env.X`,
    // `env.X`, `process.env['X']`, `{ X } = process.env`.
    for (const m of text.matchAll(/\benv\??\.CLAUDE_PLUGIN_DATA\b|\benv\s*\[\s*['"`]CLAUDE_PLUGIN_DATA['"`]\s*\]|\{[^}]*\bCLAUDE_PLUGIN_DATA\b[^}]*\}\s*=\s*(?:process\.)?env\b/g)) {
      add('data-env', path, text, m.index, 'scripts take the plugin data directory from --data, not from the environment');
    }
  }

  // No token handling anywhere in scripts or hooks: GitHub access goes through gh (CFG-3).
  for (const path of [...files(root, 'scripts', isCode), ...files(root, 'hooks', isCode)]) {
    const text = readFileSync(path, 'utf8');
    for (const m of text.matchAll(/\bGH_TOKEN\b|\bGITHUB_TOKEN\b|\bGH_ENTERPRISE_TOKEN\b|\bGITHUB_ENTERPRISE_TOKEN\b|['"`]auth['"`]\s*,\s*['"`]token['"`]|\bgh auth token\b|--show-token\b|--with-token\b/g)) {
      add('token', path, text, m.index, 'never read or store GitHub tokens; call gh and let it use the login');
    }
  }

  return violations;
}
