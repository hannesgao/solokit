// Shared by the E2 runner (run.mjs) and the repo applier (apply.mjs):
// `gh api` with status, and the ruleset intent view, hash and diff that
// ADR 0003 defines. Node built-ins only.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// `gh api` with the HTTP status and parsed body; never throws on HTTP errors.
export function ghApi(method, path, body) {
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
  return { api: `${method} ${path}`, sent: body, status, body: json ?? (text || null), stderr: r.stderr?.trim() || undefined };
}

const sortKeys = v =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]))
      : v;

// The subset of a ruleset that states intent, with rules ordered by type and
// keys sorted, so the same intent always hashes the same.
export function normalizeRuleset(r) {
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
export function diff(a, b, path = '') {
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
