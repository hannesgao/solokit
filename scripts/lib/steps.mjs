// Idempotent steps (CORE-4): every step checks the real state first, so a
// finished step is reported as done and skipped, whatever state.json says.
import { defaultRecovery, failStep, readState, withState } from './state.mjs';

// Runs `steps` in order. Each step is `{ name, check(ctx), run(ctx) }`:
// `check` answers whether the step's complete outcome already exists (files,
// git, GitHub), never a partial one, and must not change anything; `run`
// produces the outcome.
//
// Returns `{ ok, migrated, steps: [{ name, status, skipped?, note? }],
// failed? }`, where status is `done`, `would run` (dry run), `failed` or
// `not run`. The first failure stops the run; `failed` carries its error, its
// recovery (CORE-7) and `notRecorded` when state.json could not be updated.
// Bookkeeping in state.json starts once the file exists, so the steps that
// create it (kickoff) run through the same runner. `options.migrations` and
// `options.schema` are passed to the state helpers (tests).
export async function runSteps(root, steps, options = {}) {
  const { dryRun = false } = options;
  const names = new Set();
  for (const step of steps) {
    if (typeof step.name !== 'string' || !step.name) throw new TypeError('every step needs a non-empty name');
    if (names.has(step.name)) throw new TypeError(`duplicate step "${step.name}"`);
    names.add(step.name);
    if (typeof step.check !== 'function' || typeof step.run !== 'function') {
      throw new TypeError(`step "${step.name}" needs check and run`);
    }
  }
  const stateOptions = { migrations: options.migrations, schema: options.schema };
  const report = { ok: true, migrated: [], steps: [] };
  const ctx = { root, dryRun };

  for (const [index, step] of steps.entries()) {
    let state;
    try {
      const read = readState(root, { ...stateOptions, write: !dryRun });
      state = read.state;
      if (index === 0) report.migrated = read.migrated;
    } catch (error) {
      return stop(report, steps, index, error);
    }
    const recorded = state?.steps?.[step.name];

    let outcomeExists;
    try {
      outcomeExists = await step.check(ctx);
    } catch (error) {
      error.message = `check failed: ${error.message}`;
      const record = state && !dryRun ? () => failStep(root, step.name, error.message, recovery(error, step), stateOptions) : null;
      return stop(report, steps, index, error, record);
    }

    if (outcomeExists) {
      const note = recorded === 'failed' ? 'outcome found; earlier failure cleared' : undefined;
      if (state && recorded !== 'done' && !dryRun) {
        try {
          await withState(root, step.name, s => s, stateOptions);
        } catch (error) {
          error.message = `could not record step "${step.name}" as done: ${error.message}`;
          return stop(report, steps, index, error);
        }
      }
      report.steps.push({ name: step.name, status: 'done', skipped: true, ...(note ? { note } : {}) });
      continue;
    }

    const note = recorded === 'done' ? 'state said done, but the outcome is missing; running it again' : undefined;
    if (dryRun) {
      report.steps.push({ name: step.name, status: 'would run', ...(note ? { note } : {}) });
      continue;
    }
    try {
      if (state) {
        await withState(root, step.name, async s => {
          await step.run(ctx);
          // The step may have changed state.json itself; keep its version.
          return readState(root, stateOptions).state ?? s;
        }, stateOptions);
      } else {
        await step.run(ctx);
        if (readState(root, stateOptions).state) await withState(root, step.name, s => s, stateOptions);
      }
      report.steps.push({ name: step.name, status: 'done', ...(note ? { note } : {}) });
    } catch (error) {
      // withState has recorded the failure when state.json existed before the
      // step; a step that created the file and then failed is recorded here.
      let record = null;
      if (!state) {
        try {
          if (readState(root, stateOptions).state) record = () => failStep(root, step.name, error.message, recovery(error, step), stateOptions);
        } catch {
          // unreadable: nothing to record into
        }
      }
      return stop(report, steps, index, error, record);
    }
  }
  return report;
}

const recovery = (error, step) => (error.recovery ??= defaultRecovery(step.name));

// Ends the run at `steps[index]`: that step failed, the rest did not run.
function stop(report, steps, index, error, record = null) {
  const name = steps[index].name;
  let notRecorded = error.failureNotRecorded !== undefined;
  if (record) {
    try {
      record();
    } catch {
      notRecorded = true;
    }
  }
  report.ok = false;
  report.steps.push({ name, status: 'failed' });
  for (const later of steps.slice(index + 1)) report.steps.push({ name: later.name, status: 'not run' });
  report.failed = {
    name,
    error: error.message,
    recovery: error.recovery ?? defaultRecovery(name),
    ...(notRecorded ? { notRecorded: true } : {}),
  };
  return report;
}
