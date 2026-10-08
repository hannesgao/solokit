// Builds a round of multiple-choice questions for AskUserQuestion (CORE-2).
//
// A question spec is:
//   { id, kind: 'preference' | 'judgement' | 'gate', question, header, flag,
//     options: [{ value, label?, description? }] in order of likelihood,
//     evidence?, configKey?, default?, recommended? }
// `evidence` is what the project itself says (a stack detected from the PRD,
// the folder name); `configKey` names the userConfig value; `default` is the
// built-in default; `recommended` is the computed recommendation of a
// judgement or gate question.
//
// The context is { flags, config, remembered, checksPassed }: flags given on
// the command line, userConfig values, remembered answers (defaults.json) and,
// for gates, whether the kit's checks passed.

export class QuestionError extends Error {}

const KINDS = ['preference', 'judgement', 'gate'];
const SOURCE_LABEL = {
  evidence: 'detected',
  config: 'from /config',
  remembered: 'last used',
  default: 'Recommended',
  recommended: 'Recommended',
};
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 4;
const HEADER_MAX = 12;

const given = v => v !== undefined && v !== null && v !== '';

// The value that comes first and where it came from (CORE-2 precedence).
function firstChoice(spec, ctx) {
  if (spec.kind === 'preference') {
    const candidates = [
      ['evidence', spec.evidence],
      ['config', spec.configKey ? ctx.config?.[spec.configKey] : undefined],
      ['remembered', ctx.remembered?.[spec.id]],
      ['default', spec.default],
    ];
    const hit = candidates.find(([, value]) => given(value));
    return hit ? { value: hit[1], source: hit[0] } : null;
  }
  if (spec.kind === 'judgement') return given(spec.recommended) ? { value: spec.recommended, source: 'recommended' } : null;
  // gate: never a remembered answer; recommend passing only after the checks.
  return ctx.checksPassed === true && given(spec.recommended) ? { value: spec.recommended, source: 'recommended' } : null;
}

function validate(spec) {
  if (!KINDS.includes(spec.kind)) throw new QuestionError(`question "${spec.id}": kind must be one of ${KINDS.join(', ')}`);
  if (!spec.flag) throw new QuestionError(`question "${spec.id}" needs a flag that supplies the same input`);
  if (!spec.header || spec.header.length > HEADER_MAX) throw new QuestionError(`question "${spec.id}": header must be 1 to ${HEADER_MAX} characters`);
  if (!Array.isArray(spec.options) || spec.options.length < 2) throw new QuestionError(`question "${spec.id}" needs at least two options`);
}

function buildQuestion(spec, ctx) {
  const options = spec.options.map(o => ({ ...o }));
  const choice = firstChoice(spec, ctx);
  let ordered = options;
  if (choice) {
    const found = options.find(o => o.value === choice.value) ?? { value: choice.value };
    ordered = [found, ...options.filter(o => o !== found)];
    found.source = choice.source;
  } else if (spec.kind === 'gate') {
    // Checks not passed: do not lead with the option that passes the gate.
    const pass = options.find(o => o.value === spec.recommended);
    if (pass) ordered = [...options.filter(o => o !== pass), pass];
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

// Returns { questions, answered }: the questions to ask in one round, and the
// inputs a flag already supplied ({ value, source: 'flag' }), which are not asked.
export function buildRound(specs, ctx = {}) {
  if (!Array.isArray(specs) || specs.length === 0) throw new QuestionError('a round needs at least one question');
  if (specs.length > MAX_QUESTIONS) throw new QuestionError(`a round holds at most four questions, got ${specs.length}`);
  const answered = {};
  const questions = [];
  for (const spec of specs) {
    validate(spec);
    const flagValue = ctx.flags?.[spec.flag];
    if (given(flagValue)) answered[spec.id] = { value: flagValue, source: 'flag' };
    else questions.push(buildQuestion(spec, ctx));
  }
  return { questions, answered };
}
