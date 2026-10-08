// Builds a round of multiple-choice questions for AskUserQuestion (CORE-2).
//
// A question spec is:
//   { id, kind: 'preference' | 'judgement' | 'gate', question, header, flag,
//     options: [{ value, label?, description? }] in order of likelihood,
//     evidence?, configKey?, default?, recommended? }
// `evidence` is what the project itself says (a stack detected from the PRD,
// the folder name); `configKey` names the userConfig value; `default` is the
// built-in default; `recommended` is the computed recommendation of a
// judgement or gate question and must be one of the options.
//
// The context is { flags, config, configDefaults, remembered, checksPassed }:
// flags given on the command line, userConfig values and the manifest's
// defaults for them, remembered answers (defaults.json) and, for gates,
// whether the kit's checks passed.

export class QuestionError extends Error {}

const KINDS = ['preference', 'judgement', 'gate'];
const SOURCE_LABEL = {
  flag: 'from flag',
  evidence: 'detected',
  config: 'from /config',
  remembered: 'last used',
  default: 'default',
  recommended: 'Recommended',
};
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 4;
const HEADER_MAX = 12;

// An own, non-empty string value of `object[key]`; inherited keys and other
// types count as not given.
const own = (object, key) =>
  object && typeof key === 'string' && Object.hasOwn(object, key) && typeof object[key] === 'string' && object[key] !== ''
    ? object[key]
    : undefined;

// A userConfig value the user actually set: one equal to the manifest's
// default is indistinguishable from an unset one, so it does not count.
function configValue(spec, ctx) {
  const value = own(ctx.config, spec.configKey);
  return value !== undefined && value !== own(ctx.configDefaults, spec.configKey) ? value : undefined;
}

// The value that comes first and where it came from (CORE-2 precedence).
function firstChoice(spec, ctx) {
  if (spec.kind === 'gate') {
    // A gate is never answered by a flag or a remembered answer; a flag only
    // puts its option first, and the passing option leads only after the checks.
    const flagged = own(ctx.flags, spec.flag);
    if (flagged !== undefined) return { value: flagged, source: 'flag' };
    return ctx.checksPassed === true && spec.recommended !== undefined ? { value: spec.recommended, source: 'recommended' } : null;
  }
  if (spec.kind === 'judgement') return spec.recommended !== undefined ? { value: spec.recommended, source: 'recommended' } : null;
  const candidates = [
    ['evidence', typeof spec.evidence === 'string' && spec.evidence !== '' ? spec.evidence : undefined],
    ['config', configValue(spec, ctx)],
    ['remembered', own(ctx.remembered, spec.id)],
    ['default', typeof spec.default === 'string' && spec.default !== '' ? spec.default : undefined],
  ];
  const hit = candidates.find(([, value]) => value !== undefined);
  return hit ? { value: hit[1], source: hit[0] } : null;
}

function validate(spec, seen) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new QuestionError('every question spec must be an object');
  if (typeof spec.id !== 'string' || !spec.id) throw new QuestionError('every question needs an id');
  if (seen.ids.has(spec.id)) throw new QuestionError(`duplicate question id "${spec.id}"`);
  if (seen.texts.has(spec.question)) throw new QuestionError(`duplicate question text "${spec.question}"`);
  seen.ids.add(spec.id);
  seen.texts.add(spec.question);
  if (!KINDS.includes(spec.kind)) throw new QuestionError(`question "${spec.id}": kind must be one of ${KINDS.join(', ')}`);
  if (typeof spec.question !== 'string' || !spec.question) throw new QuestionError(`question "${spec.id}" needs question text`);
  if (typeof spec.flag !== 'string' || !spec.flag) throw new QuestionError(`question "${spec.id}" needs a flag that supplies the same input`);
  if (typeof spec.header !== 'string' || !spec.header || spec.header.length > HEADER_MAX) throw new QuestionError(`question "${spec.id}": header must be 1 to ${HEADER_MAX} characters`);
  if (!Array.isArray(spec.options) || spec.options.length < 2) throw new QuestionError(`question "${spec.id}" needs at least two options`);
  const values = spec.options.map(o => o?.value);
  if (values.some(v => typeof v !== 'string' || !v)) throw new QuestionError(`question "${spec.id}": every option needs a string value`);
  const labels = spec.options.map(o => o.label ?? o.value);
  if (new Set(values).size !== values.length || new Set(labels).size !== labels.length) throw new QuestionError(`question "${spec.id}" has a duplicate option`);
  if (spec.kind !== 'preference' && spec.recommended !== undefined && !values.includes(spec.recommended)) {
    throw new QuestionError(`question "${spec.id}": recommended "${spec.recommended}" must be one of the options`);
  }
}

function buildQuestion(spec, ctx) {
  const options = spec.options.map(o => ({ ...o }));
  const choice = firstChoice(spec, ctx);
  let ordered = options;
  if (choice) {
    const found = options.find(o => o.value === choice.value) ?? { value: choice.value };
    found.source = choice.source;
    ordered = [found, ...options.filter(o => o !== found)];
  } else if (spec.kind === 'gate' && spec.recommended !== undefined) {
    // Checks not passed: the passing option does not lead, but stays shown.
    const pass = options.find(o => o.value === spec.recommended);
    const rest = options.filter(o => o !== pass);
    const at = Math.min(rest.length, MAX_OPTIONS - 1);
    ordered = [...rest.slice(0, at), pass, ...rest.slice(at)];
  }
  const shown = ordered.slice(0, MAX_OPTIONS);
  const more = ordered.slice(MAX_OPTIONS).map(o => o.value);
  return {
    id: spec.id,
    question: spec.question,
    header: spec.header,
    multiSelect: false,
    options: shown.map(o => ({
      value: o.value,
      label: `${o.label ?? o.value}${o.source ? ` (${SOURCE_LABEL[o.source]})` : ''}`,
      description: o.description ?? '',
    })),
    ...(more.length ? { more } : {}),
  };
}

// Returns { questions, ask, answered }:
// - `questions`: the round to ask, each with its `id`, every option with its
//   `value`, and `more` for options left to Other;
// - `ask`: the same round as AskUserQuestion takes it, those fields stripped;
// - `answered`: inputs a flag supplied ({ value, source: 'flag' }), not asked.
//   Gates are never answered this way.
export function buildRound(specs, ctx = {}) {
  if (!Array.isArray(specs) || specs.length === 0) throw new QuestionError('a round needs at least one question');
  if (specs.length > MAX_QUESTIONS) throw new QuestionError(`a round holds at most four questions, got ${specs.length}`);
  const seen = { ids: new Set(), texts: new Set() };
  const answered = {};
  const questions = [];
  for (const spec of specs) {
    validate(spec, seen);
    const flagValue = own(ctx.flags, spec.flag);
    if (flagValue !== undefined && spec.kind !== 'gate') answered[spec.id] = { value: flagValue, source: 'flag' };
    else questions.push(buildQuestion(spec, ctx));
  }
  const ask = {
    questions: questions.map(q => ({
      question: q.question,
      header: q.header,
      multiSelect: q.multiSelect,
      options: q.options.map(o => ({ label: o.label, description: o.description })),
    })),
  };
  return { questions, ask, answered };
}
